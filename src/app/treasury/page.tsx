"use client";

import { useEffect, useState } from "react";
import { formatCurrency, formatDate, formatPercent } from "@/lib/format";

interface Account {
  id: string;
  name: string;
  shortName: string;
  currency: string;
  bank: string;
  purpose: string | null;
  minFloat: number | null;
  cardHolder: string | null;
  latestBalance: number;
  balancePkr: number;
  balanceDate: string | null;
}

interface FxConversion {
  id: string;
  date: string;
  fromCurrency: string;
  toCurrency: string;
  amountSent: number;
  wireFee: number;
  amountReceived: number;
  impliedRate: number;
  sbpRate: number | null;
  slippage: number | null;
  isFlagged: boolean;
  referenceCode: string | null;
  notes: string | null;
}

interface BofaStatus {
  accountId: string;
  accountName: string;
  currentBalance: number;
  minFloat: number;
  isBelowMinFloat: boolean;
  shortfall: number;
}

interface TreasuryData {
  accounts: Account[];
  totalByCurrency: Record<string, number>;
  bofaFloatStatus: BofaStatus | null;
  recentFxConversions: FxConversion[];
}

export default function TreasuryPage() {
  const [data, setData] = useState<TreasuryData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/treasury")
      .then((res) => res.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-slate-400">Loading treasury...</div>;
  }

  if (!data) {
    return <div className="text-center py-12 text-red-500">Failed to load treasury data.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Treasury</h1>
        <p className="text-sm text-slate-500 mt-1">Bank accounts, cash positions, and FX conversions</p>
      </div>

      {/* BoFA Alert */}
      {data.bofaFloatStatus?.isBelowMinFloat && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <span className="text-red-500 text-lg mt-0.5">&#9888;</span>
          <div>
            <p className="text-sm font-semibold text-red-800">BoFA Float Alert</p>
            <p className="text-sm text-red-700 mt-0.5">
              Balance {formatCurrency(data.bofaFloatStatus.currentBalance, "USD")} is below minimum float {formatCurrency(data.bofaFloatStatus.minFloat, "USD")}.
              Shortfall: {formatCurrency(data.bofaFloatStatus.shortfall, "USD")}
            </p>
          </div>
        </div>
      )}

      {/* Total by Currency */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Object.entries(data.totalByCurrency).map(([currency, total]) => (
          <div key={currency} className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-medium text-slate-500 uppercase">{currency} Total</p>
            <p className="text-lg font-bold text-slate-900 mt-1">{formatCurrency(total, currency)}</p>
          </div>
        ))}
      </div>

      {/* Bank Accounts */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">Bank Accounts</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Account</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Bank</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Currency</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Purpose</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase">Balance</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase">PKR Equiv.</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">As Of</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.accounts.map((account) => (
                <tr key={account.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{account.shortName}</p>
                    <p className="text-xs text-slate-500">{account.name}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{account.bank}</td>
                  <td className="px-4 py-3 text-slate-600">{account.currency}</td>
                  <td className="px-4 py-3 text-slate-600 max-w-[200px] truncate">{account.purpose || "—"}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900 whitespace-nowrap">
                    {formatCurrency(account.latestBalance, account.currency)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500 whitespace-nowrap">
                    {account.currency !== "PKR" ? formatCurrency(account.balancePkr, "PKR") : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                    {account.balanceDate ? formatDate(account.balanceDate) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* FX Conversions */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">Recent FX Conversions</h2>
        </div>
        {data.recentFxConversions.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-slate-400">No FX conversions recorded</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Pair</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase">Sent</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase">Wire Fee</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase">Received</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase">Implied Rate</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase">SBP Rate</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase">Slippage</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-slate-500 uppercase">Flag</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.recentFxConversions.map((fx) => (
                  <tr key={fx.id} className={`hover:bg-slate-50 ${fx.isFlagged ? "bg-red-50/50" : ""}`}>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{formatDate(fx.date)}</td>
                    <td className="px-4 py-3 text-slate-600">{fx.fromCurrency}/{fx.toCurrency}</td>
                    <td className="px-4 py-3 text-right text-slate-900 whitespace-nowrap">{formatCurrency(fx.amountSent, fx.fromCurrency)}</td>
                    <td className="px-4 py-3 text-right text-slate-500 whitespace-nowrap">{formatCurrency(fx.wireFee, fx.fromCurrency)}</td>
                    <td className="px-4 py-3 text-right text-slate-900 whitespace-nowrap">{formatCurrency(fx.amountReceived, fx.toCurrency)}</td>
                    <td className="px-4 py-3 text-right text-slate-900 font-medium">{fx.impliedRate.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-slate-500">{fx.sbpRate?.toFixed(2) ?? "—"}</td>
                    <td className={`px-4 py-3 text-right font-medium ${fx.isFlagged ? "text-red-600" : "text-slate-500"}`}>
                      {fx.slippage != null ? formatPercent(fx.slippage) : "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {fx.isFlagged && <span className="text-red-500">&#9888;</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
