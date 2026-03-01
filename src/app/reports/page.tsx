"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/format";
import { UNIT_LABELS, LINES_OF_SERVICE } from "@/lib/constants";

interface ReportData {
  revenueMTD: number;
  grossProfit: number;
  revenueByLine: Record<string, number>;
  partnerDrawSummary: {
    partnerId: string;
    partnerName: string;
    ownershipPct: number;
    totalDrawsYTD: number;
  }[];
}

export default function ReportsPage() {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((res) => res.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-slate-400">Loading reports...</div>;
  }

  if (!data) {
    return <div className="text-center py-12 text-red-500">Failed to load report data.</div>;
  }

  const totalRevenue = Object.values(data.revenueByLine).reduce((s, v) => s + v, 0);
  const totalDraws = data.partnerDrawSummary.reduce((s, p) => s + p.totalDrawsYTD, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
        <p className="text-sm text-slate-500 mt-1">Financial summaries and P&L overview</p>
      </div>

      {/* P&L Summary */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">Profit & Loss Summary (MTD)</h2>
        <div className="space-y-3">
          <div className="flex justify-between py-2 border-b border-slate-100">
            <span className="text-sm text-slate-600">Total Revenue</span>
            <span className="text-sm font-semibold text-green-600">{formatCurrency(data.revenueMTD, "PKR")}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-slate-100">
            <span className="text-sm text-slate-600">Direct Costs</span>
            <span className="text-sm font-semibold text-red-600">{formatCurrency(data.revenueMTD - data.grossProfit, "PKR")}</span>
          </div>
          <div className="flex justify-between py-2 bg-slate-50 px-3 rounded-lg">
            <span className="text-sm font-semibold text-slate-900">Gross Profit</span>
            <span className="text-sm font-bold text-slate-900">{formatCurrency(data.grossProfit, "PKR")}</span>
          </div>
          {data.revenueMTD > 0 && (
            <div className="flex justify-between py-2">
              <span className="text-sm text-slate-500">Gross Margin</span>
              <span className="text-sm font-medium text-slate-700">{((data.grossProfit / data.revenueMTD) * 100).toFixed(1)}%</span>
            </div>
          )}
        </div>
      </div>

      {/* Revenue by Line */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">Revenue by Line of Service (MTD)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-2 text-xs font-medium text-slate-500 uppercase">Line of Service</th>
                <th className="text-right py-2 text-xs font-medium text-slate-500 uppercase">Revenue</th>
                <th className="text-right py-2 text-xs font-medium text-slate-500 uppercase">% of Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {LINES_OF_SERVICE.map((line) => (
                <tr key={line}>
                  <td className="py-2.5 text-slate-900">{UNIT_LABELS[line]}</td>
                  <td className="py-2.5 text-right font-medium text-slate-900">{formatCurrency(data.revenueByLine[line] || 0, "PKR")}</td>
                  <td className="py-2.5 text-right text-slate-500">
                    {totalRevenue > 0 ? (((data.revenueByLine[line] || 0) / totalRevenue) * 100).toFixed(1) : "0.0"}%
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300">
                <td className="py-2.5 font-semibold text-slate-900">Total</td>
                <td className="py-2.5 text-right font-bold text-slate-900">{formatCurrency(totalRevenue, "PKR")}</td>
                <td className="py-2.5 text-right text-slate-500">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Partner Draws */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">Partner Draws YTD</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-2 text-xs font-medium text-slate-500 uppercase">Partner</th>
                <th className="text-right py-2 text-xs font-medium text-slate-500 uppercase">Ownership</th>
                <th className="text-right py-2 text-xs font-medium text-slate-500 uppercase">Total Draws YTD</th>
                <th className="text-right py-2 text-xs font-medium text-slate-500 uppercase">% of Total Draws</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.partnerDrawSummary.map((partner) => (
                <tr key={partner.partnerId}>
                  <td className="py-2.5 text-slate-900">{partner.partnerName}</td>
                  <td className="py-2.5 text-right text-slate-600">{partner.ownershipPct.toFixed(2)}%</td>
                  <td className="py-2.5 text-right font-medium text-slate-900">{formatCurrency(partner.totalDrawsYTD, "PKR")}</td>
                  <td className="py-2.5 text-right text-slate-500">
                    {totalDraws > 0 ? ((partner.totalDrawsYTD / totalDraws) * 100).toFixed(1) : "0.0"}%
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300">
                <td className="py-2.5 font-semibold text-slate-900">Total</td>
                <td className="py-2.5"></td>
                <td className="py-2.5 text-right font-bold text-slate-900">{formatCurrency(totalDraws, "PKR")}</td>
                <td className="py-2.5 text-right text-slate-500">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
