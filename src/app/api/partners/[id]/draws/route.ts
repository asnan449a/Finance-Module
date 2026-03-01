import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period");

    const partner = await prisma.partner.findUnique({
      where: { id },
    });

    if (!partner) {
      return NextResponse.json(
        { error: "Partner not found" },
        { status: 404 }
      );
    }

    const where: Record<string, unknown> = { partnerId: id };
    if (period) where.period = period;

    const draws = await prisma.partnerDraw.findMany({
      where,
      orderBy: { date: "desc" },
    });

    const totalDraws = draws
      .filter((d) => d.isDraw)
      .reduce((sum, d) => sum + d.amountPkr, 0);

    return NextResponse.json({
      partnerId: id,
      partnerName: partner.name,
      draws,
      totalDraws,
      count: draws.length,
    });
  } catch (error) {
    console.error("Partner draws GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch partner draws" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const body = await request.json();

    const partner = await prisma.partner.findUnique({
      where: { id },
    });

    if (!partner) {
      return NextResponse.json(
        { error: "Partner not found" },
        { status: 404 }
      );
    }

    const {
      date,
      amount,
      currency,
      amountPkr,
      description,
      category,
      isDraw,
      period,
      notes,
    } = body;

    if (
      !date ||
      amount === undefined ||
      amountPkr === undefined ||
      !description ||
      !category ||
      !period
    ) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: date, amount, amountPkr, description, category, period",
        },
        { status: 400 }
      );
    }

    const draw = await prisma.partnerDraw.create({
      data: {
        partnerId: id,
        date: new Date(date),
        amount,
        currency: currency ?? "USD",
        amountPkr,
        description,
        category,
        isDraw: isDraw ?? true,
        period,
        notes: notes ?? null,
      },
    });

    return NextResponse.json(draw, { status: 201 });
  } catch (error) {
    console.error("Partner draw POST error:", error);
    return NextResponse.json(
      { error: "Failed to create partner draw" },
      { status: 500 }
    );
  }
}
