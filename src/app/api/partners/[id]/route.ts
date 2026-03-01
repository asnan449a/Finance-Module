import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    const partner = await prisma.partner.findUnique({
      where: { id },
      include: {
        drawEntries: {
          orderBy: { date: "desc" },
        },
        distributions: {
          orderBy: { createdAt: "desc" },
        },
        capitalEntries: {
          orderBy: { date: "desc" },
        },
      },
    });

    if (!partner) {
      return NextResponse.json(
        { error: "Partner not found" },
        { status: 404 }
      );
    }

    const totalDrawsYTD = partner.drawEntries
      .filter((d) => {
        const startOfYear = new Date(new Date().getFullYear(), 0, 1);
        return d.isDraw && new Date(d.date) >= startOfYear;
      })
      .reduce((sum, draw) => sum + draw.amountPkr, 0);

    const totalCapital = partner.capitalEntries.reduce(
      (sum, entry) => sum + entry.amountPkr,
      0
    );

    return NextResponse.json({
      ...partner,
      totalDrawsYTD,
      totalCapital,
    });
  } catch (error) {
    console.error("Partner GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch partner" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const body = await request.json();

    const existing = await prisma.partner.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Partner not found" },
        { status: 404 }
      );
    }

    const {
      name,
      ownershipPct,
      role,
      drawMechanism,
      notes,
      isEmployee,
      employeeId,
    } = body;

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (ownershipPct !== undefined) updateData.ownershipPct = ownershipPct;
    if (role !== undefined) updateData.role = role;
    if (drawMechanism !== undefined) updateData.drawMechanism = drawMechanism;
    if (notes !== undefined) updateData.notes = notes;
    if (isEmployee !== undefined) updateData.isEmployee = isEmployee;
    if (employeeId !== undefined) updateData.employeeId = employeeId;

    const partner = await prisma.partner.update({
      where: { id },
      data: updateData,
      include: {
        drawEntries: {
          orderBy: { date: "desc" },
        },
        distributions: {
          orderBy: { createdAt: "desc" },
        },
        capitalEntries: {
          orderBy: { date: "desc" },
        },
      },
    });

    return NextResponse.json(partner);
  } catch (error) {
    console.error("Partner PUT error:", error);
    return NextResponse.json(
      { error: "Failed to update partner" },
      { status: 500 }
    );
  }
}
