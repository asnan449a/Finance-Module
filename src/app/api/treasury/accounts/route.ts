import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_request: NextRequest) {
  try {
    const accounts = await prisma.bankAccount.findMany({
      include: {
        balances: {
          orderBy: { date: "desc" },
          take: 1,
        },
      },
      orderBy: { name: "asc" },
    });

    const result = accounts.map((account) => ({
      ...account,
      latestBalance: account.balances[0]?.balance ?? 0,
      balancePkr: account.balances[0]?.balancePkr ?? 0,
      balanceDate: account.balances[0]?.date ?? null,
      balances: undefined,
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error("Bank accounts GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch bank accounts" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      name,
      shortName,
      currency,
      bank,
      purpose,
      minFloat,
      cardHolder,
      isActive,
    } = body;

    if (!name || !shortName || !currency || !bank) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: name, shortName, currency, bank",
        },
        { status: 400 }
      );
    }

    const account = await prisma.bankAccount.create({
      data: {
        name,
        shortName,
        currency,
        bank,
        purpose: purpose ?? null,
        minFloat: minFloat ?? null,
        cardHolder: cardHolder ?? null,
        isActive: isActive ?? true,
      },
    });

    return NextResponse.json(account, { status: 201 });
  } catch (error) {
    console.error("Bank account POST error:", error);
    return NextResponse.json(
      { error: "Failed to create bank account" },
      { status: 500 }
    );
  }
}
