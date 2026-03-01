"use client";

import { useEffect, useState } from "react";
import { formatCurrency, formatPercent } from "@/lib/format";
import { UNIT_LABELS } from "@/lib/constants";

interface DashboardData {
  revenueMTD: number;
  grossProfit: number;
  cashPositions: {
    id: string;
    name: string;
    shortName: string;
    currency: string;
    bank: string;
    latestBalance: number;
    balancePkr: number;
  }[];
  revenueByLine: Record<string, number>;
  unclassifiedCount: number;
  bofaAlert: {
    accountName: string;
    currentBalance: number;
    minFloat: number;
    isBelowMinFloat: boolean;
  } | null;
  partnerDrawSummary: {
    partnerId: string;
    partnerName: string;
    ownershipPct: number;
    totalDrawsYTD: number;
  }[];
  asOf: string;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((res) => res.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400">Loading dashboard...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12 text-red-500">
        Failed to load dashboard data. Make sure you have run{" "}
        <code className="bg-slate-100 px-2 py-1 rounded">npm run seed</code> first.
      </div>
    );
  }

  const totalCashPkr = data.cashPositions.reduce((sum, a) => sum + a.balancePkr, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">
          Financial overview as of {new Date(data.asOf).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        </p>
      </div>

      {/* Alerts */}
      {data.bofaAlert?.isBelowMinFloat && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <span className="text-red-500 text-lg mt-0.5">&#9888;</span>
          <div>
            <p className="text-sm font-semibold text-red-800">BoFA Balance Alert</p>
            <p className="text-sm text-red-700 mt-0.5">
              {data.bofaAlert.accountName} balance ({formatCurrency(data.bofaAlert.currentBalance, "USD")}) is below the minimum float requirement ({formatCurrency(data.bofaAlert.minFloat, "USD")}).
            </p>
          </div>
        </div>
      )}

      {data.unclassifiedCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <span className="text-amber-500 text-lg mt-0.5">&#9888;</span>
          <div>
            <p className="text-sm font-semibold text-amber-800">Unclassified Transactions</p>
            <p className="text-sm text-amber-700 mt-0.5">
              {data.unclassifiedCount} transaction{data.unclassifiedCount > 1 ? "s" : ""} need classification.
            </p>
          </div>
        </div>
      )}

      {/* Top KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Revenue MTD</p>
          <p className="text-2xl font-bold text-slate-900 mt-2">{formatCurrency(data.revenueMTD, "PKR")}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Gross Profit MTD</p>
          <p className="text-2xl font-bold text-slate-900 mt-2">{formatCurrency(data.grossProfit, "PKR")}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Total Cash (PKR Equiv.)</p>
          <p className="text-2xl font-bold text-slate-900 mt-2">{formatCurrency(totalCashPkr, "PKR")}</p>
        </div>
      </div>

      {/* Revenue by Line of Service */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">Revenue by Line of Service (MTD)</h2>
        <div className="space-y-3">
          {Object.entries(data.revenueByLine).map(([line, amount]) => {
            const maxRevenue = Math.max(...Object.values(data.revenueByLine), 1);
            const pct = (amount / maxRevenue) * 100;
            return (
              <div key={line}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-600">{UNIT_LABELS[line] || line}</span>
                  <span className="font-medium text-slate-900">{formatCurrency(amount, "PKR")}</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cash Positions */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">Cash Positions</h2>
          <div className="space-y-3">
            {data.cashPositions.map((account) => (
              <div key={account.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                <div>
                  <p className="text-sm font-medium text-slate-900">{account.shortName}</p>
                  <p className="text-xs text-slate-500">{account.bank} &middot; {account.currency}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-slate-900">{formatCurrency(account.latestBalance, account.currency)}</p>
                  {account.currency !== "PKR" && (
                    <p className="text-xs text-slate-400">{formatCurrency(account.balancePkr, "PKR")}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Partner Draws YTD */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">Partner Draws YTD</h2>
          <div className="space-y-3">
            {data.partnerDrawSummary.map((partner) => (
              <div key={partner.partnerId} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                <div>
                  <p className="text-sm font-medium text-slate-900">{partner.partnerName}</p>
                  <p className="text-xs text-slate-500">Ownership: {formatPercent(partner.ownershipPct)}</p>
                </div>
                <p className="text-sm font-semibold text-slate-900">{formatCurrency(partner.totalDrawsYTD, "PKR")}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
