import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { BOFA_MIN_FLOAT } from "@/lib/constants";

export async function GET(_request: NextRequest) {
  try {
    // Get all bank accounts with latest balance
    const bankAccounts = await prisma.bankAccount.findMany({
      where: { isActive: true },
      include: {
        balances: {
          orderBy: { date: "desc" },
          take: 1,
        },
      },
      orderBy: { name: "asc" },
    });

    const accountBalances = bankAccounts.map((account) => ({
      id: account.id,
      name: account.name,
      shortName: account.shortName,
      currency: account.currency,
      bank: account.bank,
      purpose: account.purpose,
      minFloat: account.minFloat,
      cardHolder: account.cardHolder,
      latestBalance: account.balances[0]?.balance ?? 0,
      balancePkr: account.balances[0]?.balancePkr ?? 0,
      balanceDate: account.balances[0]?.date ?? null,
    }));

    // Total by currency
    const totalByCurrency: Record<string, number> = {};
    for (const account of accountBalances) {
      const currency = account.currency;
      if (!totalByCurrency[currency]) {
        totalByCurrency[currency] = 0;
      }
      totalByCurrency[currency] += account.latestBalance;
    }

    // BoFA float status
    const bofaAccount = accountBalances.find(
      (a) =>
        a.bank.toLowerCase().includes("bofa") ||
        a.bank.toLowerCase().includes("bank of america")
    );
    const bofaFloatStatus = bofaAccount
      ? {
          accountId: bofaAccount.id,
          accountName: bofaAccount.name,
          currentBalance: bofaAccount.latestBalance,
          minFloat: bofaAccount.minFloat ?? BOFA_MIN_FLOAT,
          isBelowMinFloat:
            bofaAccount.latestBalance <
            (bofaAccount.minFloat ?? BOFA_MIN_FLOAT),
          shortfall:
            bofaAccount.latestBalance <
            (bofaAccount.minFloat ?? BOFA_MIN_FLOAT)
              ? (bofaAccount.minFloat ?? BOFA_MIN_FLOAT) -
                bofaAccount.latestBalance
              : 0,
        }
      : null;

    // Recent FX conversions (last 10)
    const recentFxConversions = await prisma.fxConversion.findMany({
      orderBy: { date: "desc" },
      take: 10,
    });

    return NextResponse.json({
      accounts: accountBalances,
      totalByCurrency,
      bofaFloatStatus,
      recentFxConversions,
    });
  } catch (error) {
    console.error("Treasury GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch treasury overview" },
      { status: 500 }
    );
  }
}
