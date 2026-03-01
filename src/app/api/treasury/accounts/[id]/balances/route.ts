import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    const account = await prisma.bankAccount.findUnique({
      where: { id },
    });

    if (!account) {
      return NextResponse.json(
        { error: "Bank account not found" },
        { status: 404 }
      );
    }

    const balances = await prisma.accountBalance.findMany({
      where: { accountId: id },
      orderBy: { date: "desc" },
    });

    return NextResponse.json({
      accountId: id,
      accountName: account.name,
      currency: account.currency,
      balances,
    });
  } catch (error) {
    console.error("Account balances GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch account balances" },
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

    const account = await prisma.bankAccount.findUnique({
      where: { id },
    });

    if (!account) {
      return NextResponse.json(
        { error: "Bank account not found" },
        { status: 404 }
      );
    }

    const { date, balance, currency, balancePkr, notes } = body;

    if (
      !date ||
      balance === undefined ||
      !currency ||
      balancePkr === undefined
    ) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: date, balance, currency, balancePkr",
        },
        { status: 400 }
      );
    }

    const accountBalance = await prisma.accountBalance.create({
      data: {
        accountId: id,
        date: new Date(date),
        balance,
        currency,
        balancePkr,
        notes: notes ?? null,
      },
    });

    return NextResponse.json(accountBalance, { status: 201 });
  } catch (error) {
    console.error("Account balance POST error:", error);
    return NextResponse.json(
      { error: "Failed to record balance" },
      { status: 500 }
    );
  }
}
