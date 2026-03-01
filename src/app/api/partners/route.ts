import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_request: NextRequest) {
  try {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const partners = await prisma.partner.findMany({
      include: {
        drawEntries: {
          where: {
            date: { gte: startOfYear },
            isDraw: true,
          },
        },
        distributions: {
          orderBy: { createdAt: "desc" },
        },
        capitalEntries: {
          orderBy: { date: "desc" },
        },
      },
      orderBy: { name: "asc" },
    });

    const result = partners.map((partner) => {
      const totalDrawsYTD = partner.drawEntries.reduce(
        (sum, draw) => sum + draw.amountPkr,
        0
      );
      const totalCapital = partner.capitalEntries.reduce(
        (sum, entry) => sum + entry.amountPkr,
        0
      );

      return {
        ...partner,
        totalDrawsYTD,
        totalCapital,
        drawCount: partner.drawEntries.length,
        distributionCount: partner.distributions.length,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Partners GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch partners" },
      { status: 500 }
    );
  }
}
