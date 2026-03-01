"use client";

import { useEffect, useState } from "react";
import { formatCurrency, formatPercent, formatDate } from "@/lib/format";

interface PartnerDraw {
  id: string;
  date: string;
  amount: number;
  currency: string;
  amountPkr: number;
  description: string;
  category: string;
}

interface Distribution {
  id: string;
  period: string;
  grossEntitlement: number;
  ytdAdvances: number;
  netPayable: number;
  status: string;
}

interface Partner {
  id: string;
  name: string;
  ownershipPct: number;
  role: string | null;
  drawMechanism: string | null;
  notes: string | null;
  isEmployee: boolean;
  totalDrawsYTD: number;
  totalCapital: number;
  drawCount: number;
  distributionCount: number;
  drawEntries: PartnerDraw[];
  distributions: Distribution[];
}

export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);

  useEffect(() => {
    fetch("/api/partners")
      .then((res) => res.json())
      .then(setPartners)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-slate-400">Loading partners...</div>;
  }

  const totalOwnership = partners.reduce((sum, p) => sum + p.ownershipPct, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Partners</h1>
        <p className="text-sm text-slate-500 mt-1">Partner ownership, draws, and capital accounts</p>
      </div>

      {/* Ownership Summary */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">Ownership Structure</h2>
        <div className="flex gap-1 h-8 rounded-lg overflow-hidden mb-4">
          {partners.map((p, i) => {
            const colors = ["bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500"];
            return (
              <div
                key={p.id}
                className={`${colors[i % colors.length]} transition-all`}
                style={{ width: `${p.ownershipPct}%` }}
                title={`${p.name}: ${formatPercent(p.ownershipPct)}`}
              />
            );
          })}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {partners.map((p, i) => {
            const colors = ["text-blue-600", "text-emerald-600", "text-violet-600", "text-amber-600"];
            const bgs = ["bg-blue-50", "bg-emerald-50", "bg-violet-50", "bg-amber-50"];
            return (
              <div key={p.id} className={`${bgs[i % bgs.length]} rounded-lg p-3`}>
                <p className={`text-xs font-medium ${colors[i % colors.length]}`}>{p.name}</p>
                <p className="text-lg font-bold text-slate-900">{formatPercent(p.ownershipPct)}</p>
                {p.drawMechanism && <p className="text-xs text-slate-500 mt-1">{p.drawMechanism}</p>}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-slate-400 mt-3 text-right">Total: {formatPercent(totalOwnership)}</p>
      </div>

      {/* Partner Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {partners.map((partner) => (
          <div
            key={partner.id}
            className="bg-white rounded-xl border border-slate-200 p-5 cursor-pointer hover:border-blue-300 transition-colors"
            onClick={() => setSelectedPartner(selectedPartner?.id === partner.id ? null : partner)}
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">{partner.name}</h3>
                <p className="text-xs text-slate-500">{partner.role || "Partner"} &middot; {formatPercent(partner.ownershipPct)} ownership</p>
              </div>
              {partner.isEmployee && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">Employee</span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-xs text-slate-500">Draws YTD</p>
                <p className="text-sm font-semibold text-slate-900">{formatCurrency(partner.totalDrawsYTD, "PKR")}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Capital</p>
                <p className="text-sm font-semibold text-slate-900">{formatCurrency(partner.totalCapital, "PKR")}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Draw Count</p>
                <p className="text-sm font-semibold text-slate-900">{partner.drawCount}</p>
              </div>
            </div>

            {/* Expanded: Draw Details */}
            {selectedPartner?.id === partner.id && partner.drawEntries.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Recent Draws</h4>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {partner.drawEntries.slice(0, 10).map((draw) => (
                    <div key={draw.id} className="flex items-center justify-between text-sm">
                      <div>
                        <p className="text-slate-700">{draw.description}</p>
                        <p className="text-xs text-slate-400">{formatDate(draw.date)} &middot; {draw.category}</p>
                      </div>
                      <p className="font-medium text-slate-900 whitespace-nowrap">{formatCurrency(draw.amount, draw.currency)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Expanded: Distributions */}
            {selectedPartner?.id === partner.id && partner.distributions.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Distributions</h4>
                <div className="space-y-2">
                  {partner.distributions.map((dist) => (
                    <div key={dist.id} className="flex items-center justify-between text-sm">
                      <div>
                        <p className="text-slate-700">{dist.period}</p>
                        <p className="text-xs text-slate-400">Gross: {formatCurrency(dist.grossEntitlement, "PKR")} | Advances: {formatCurrency(dist.ytdAdvances, "PKR")}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-slate-900">{formatCurrency(dist.netPayable, "PKR")}</p>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${dist.status === "PAID" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                          {dist.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
