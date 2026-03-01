import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LINES_OF_SERVICE, BOFA_MIN_FLOAT } from "@/lib/constants";

export async function GET(_request: NextRequest) {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    // Total revenue MTD (sum of credit transactions for current month)
    const revenueMTD = await prisma.transaction.aggregate({
      _sum: { amountPkr: true },
      where: {
        direction: "CREDIT",
        category: "Revenue",
        date: { gte: startOfMonth },
      },
    });

    // Direct costs MTD (salary + tools + travel)
    const directCostsMTD = await prisma.transaction.aggregate({
      _sum: { amountPkr: true },
      where: {
        direction: "DEBIT",
        category: { in: ["Salary", "Tools", "Travel", "Payroll"] },
        date: { gte: startOfMonth },
      },
    });

    const totalRevenue = revenueMTD._sum.amountPkr || 0;
    const totalDirectCosts = directCostsMTD._sum.amountPkr || 0;
    const grossProfit = totalRevenue - totalDirectCosts;

    // Cash positions by account (latest balance for each bank account)
    const bankAccounts = await prisma.bankAccount.findMany({
      where: { isActive: true },
      include: {
        balances: {
          orderBy: { date: "desc" },
          take: 1,
        },
      },
    });

    const cashPositions = bankAccounts.map((account) => ({
      id: account.id,
      name: account.name,
      shortName: account.shortName,
      currency: account.currency,
      bank: account.bank,
      latestBalance: account.balances[0]?.balance ?? 0,
      balancePkr: account.balances[0]?.balancePkr ?? 0,
      balanceDate: account.balances[0]?.date ?? null,
    }));

    // Revenue by line of service
    const revenueByLine: Record<string, number> = {};
    for (const line of LINES_OF_SERVICE) {
      const result = await prisma.transaction.aggregate({
        _sum: { amountPkr: true },
        where: {
          direction: "CREDIT",
          category: "Revenue",
          lineOfService: line,
          date: { gte: startOfMonth },
        },
      });
      revenueByLine[line] = result._sum.amountPkr || 0;
    }

    // Unclassified transaction count
    const unclassifiedCount = await prisma.transaction.count({
      where: { status: "UNCLASSIFIED" },
    });

    // BoFA balance alert
    const bofaAccount = bankAccounts.find(
      (a) => a.bank.toLowerCase().includes("bofa") || a.bank.toLowerCase().includes("bank of america")
    );
    const bofaBalance = bofaAccount?.balances[0]?.balance ?? 0;
    const bofaAlert = bofaAccount
      ? {
          accountId: bofaAccount.id,
          accountName: bofaAccount.name,
          currentBalance: bofaBalance,
          minFloat: bofaAccount.minFloat ?? BOFA_MIN_FLOAT,
          isBelowMinFloat: bofaBalance < (bofaAccount.minFloat ?? BOFA_MIN_FLOAT),
        }
      : null;

    // Partner draw summary (total draws per partner YTD)
    const partnerDraws = await prisma.partnerDraw.groupBy({
      by: ["partnerId"],
      _sum: { amountPkr: true },
      where: {
        date: { gte: startOfYear },
        isDraw: true,
      },
    });

    const partners = await prisma.partner.findMany();
    const partnerDrawSummary = partners.map((partner) => {
      const draw = partnerDraws.find((d) => d.partnerId === partner.id);
      return {
        partnerId: partner.id,
        partnerName: partner.name,
        ownershipPct: partner.ownershipPct,
        totalDrawsYTD: draw?._sum.amountPkr || 0,
      };
    });

    return NextResponse.json({
      revenueMTD: totalRevenue,
      grossProfit,
      cashPositions,
      revenueByLine,
      unclassifiedCount,
      bofaAlert,
      partnerDrawSummary,
      asOf: now.toISOString(),
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    return NextResponse.json(
      { error: "Failed to load dashboard data" },
      { status: 500 }
    );
  }
}
