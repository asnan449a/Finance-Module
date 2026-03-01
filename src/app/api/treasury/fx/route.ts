import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { FX_SLIPPAGE_THRESHOLD } from "@/lib/constants";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const flaggedOnly = searchParams.get("flaggedOnly");

    const where: Record<string, unknown> = {};

    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom)
        (where.date as Record<string, unknown>).gte = new Date(dateFrom);
      if (dateTo)
        (where.date as Record<string, unknown>).lte = new Date(dateTo);
    }

    if (flaggedOnly === "true") {
      where.isFlagged = true;
    }

    const conversions = await prisma.fxConversion.findMany({
      where,
      orderBy: { date: "desc" },
    });

    return NextResponse.json(conversions);
  } catch (error) {
    console.error("FX conversions GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch FX conversions" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      date,
      fromCurrency,
      toCurrency,
      amountSent,
      wireFee,
      amountReceived,
      sbpRate,
      referenceCode,
      notes,
    } = body;

    if (
      !date ||
      amountSent === undefined ||
      amountReceived === undefined
    ) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: date, amountSent, amountReceived",
        },
        { status: 400 }
      );
    }

    // Auto-calculate implied rate
    const netAmountSent = amountSent - (wireFee ?? 45);
    const impliedRate =
      netAmountSent > 0 ? amountReceived / netAmountSent : 0;

    // Auto-calculate slippage and flag if > threshold
    let slippage: number | null = null;
    let isFlagged = false;

    if (sbpRate && sbpRate > 0) {
      slippage =
        Math.abs((impliedRate - sbpRate) / sbpRate) * 100;
      isFlagged = slippage > FX_SLIPPAGE_THRESHOLD;
    }

    const conversion = await prisma.fxConversion.create({
      data: {
        date: new Date(date),
        fromCurrency: fromCurrency ?? "USD",
        toCurrency: toCurrency ?? "PKR",
        amountSent,
        wireFee: wireFee ?? 45,
        amountReceived,
        impliedRate,
        sbpRate: sbpRate ?? null,
        slippage,
        isFlagged,
        referenceCode: referenceCode ?? null,
        notes: notes ?? null,
      },
    });

    return NextResponse.json(conversion, { status: 201 });
  } catch (error) {
    console.error("FX conversion POST error:", error);
    return NextResponse.json(
      { error: "Failed to create FX conversion" },
      { status: 500 }
    );
  }
}
