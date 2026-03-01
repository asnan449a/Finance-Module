import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_request: NextRequest) {
  try {
    const distributions = await prisma.distribution.findMany({
      include: {
        partner: {
          select: {
            id: true,
            name: true,
            ownershipPct: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(distributions);
  } catch (error) {
    console.error("Distributions GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch distributions" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { period, netDistributableProfit } = body;

    if (!period || netDistributableProfit === undefined) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: period, netDistributableProfit",
        },
        { status: 400 }
      );
    }

    const partners = await prisma.partner.findMany();

    if (partners.length === 0) {
      return NextResponse.json(
        { error: "No partners found" },
        { status: 404 }
      );
    }

    // Get YTD advances for each partner in this period
    const startOfYear = new Date(new Date().getFullYear(), 0, 1);

    const distributions = await prisma.$transaction(async (tx) => {
      const results = [];
      for (const partner of partners) {
        const drawResult = await tx.partnerDraw.aggregate({
          _sum: { amountPkr: true },
          where: {
            partnerId: partner.id,
            isDraw: true,
            date: { gte: startOfYear },
          },
        });

        const ytdAdvances = drawResult._sum.amountPkr || 0;
        const grossEntitlement =
          netDistributableProfit * (partner.ownershipPct / 100);
        const netPayable = grossEntitlement - ytdAdvances;

        const distribution = await tx.distribution.create({
          data: {
            partnerId: partner.id,
            period,
            grossEntitlement,
            ytdAdvances,
            netPayable,
            status: "CALCULATED",
          },
          include: {
            partner: {
              select: {
                id: true,
                name: true,
                ownershipPct: true,
              },
            },
          },
        });

        results.push(distribution);
      }
      return results;
    });

    return NextResponse.json(
      {
        period,
        netDistributableProfit,
        distributions,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Distributions POST error:", error);
    return NextResponse.json(
      { error: "Failed to calculate distributions" },
      { status: 500 }
    );
  }
}
