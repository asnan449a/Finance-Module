import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_request: NextRequest) {
  try {
    const assets = await prisma.fixedAsset.findMany({
      include: {
        additions: {
          orderBy: { date: "asc" },
        },
        depreciationEntries: {
          orderBy: { date: "asc" },
        },
        capitalContributions: {
          include: {
            partner: {
              select: { name: true },
            },
          },
          orderBy: { date: "asc" },
        },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json(assets);
  } catch (error) {
    console.error("Assets GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch assets" },
      { status: 500 }
    );
  }
}
