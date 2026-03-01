"use client";

import { useEffect, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/format";

interface AssetAddition {
  id: string;
  date: string;
  description: string;
  amount: number;
  currency: string;
  vendor: string | null;
}

interface DepreciationEntry {
  id: string;
  date: string;
  amount: number;
  bookValue: number;
  period: string;
}

interface CapitalContribution {
  id: string;
  date: string;
  amount: number;
  currency: string;
  amountPkr: number;
  description: string;
  partner: {
    name: string;
  } | null;
}

interface FixedAsset {
  id: string;
  name: string;
  description: string | null;
  assetType: string;
  acquisitionDate: string;
  totalCost: number;
  currency: string;
  landValue: number | null;
  buildingValue: number | null;
  usefulLifeYears: number | null;
  depreciationMethod: string;
  additions: AssetAddition[];
  depreciationEntries: DepreciationEntry[];
  capitalContributions: CapitalContribution[];
}

export default function AssetsPage() {
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/assets")
      .then((res) => {
        if (!res.ok) throw new Error("API not found");
        return res.json();
      })
      .then(setAssets)
      .catch(() => {
        // API may not exist yet, try direct DB fetch through treasury
        setAssets([]);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-slate-400">Loading assets...</div>;
  }

  if (assets.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Fixed Assets</h1>
          <p className="text-sm text-slate-500 mt-1">Property, equipment, and depreciation tracking</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <p className="text-slate-400">No assets data available. The assets API endpoint may need to be created.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Fixed Assets</h1>
        <p className="text-sm text-slate-500 mt-1">Property, equipment, and depreciation tracking</p>
      </div>

      {assets.map((asset) => {
        const totalAdditions = asset.additions.reduce((sum, a) => sum + a.amount, 0);
        const latestDepreciation = asset.depreciationEntries[asset.depreciationEntries.length - 1];
        const totalCapital = asset.capitalContributions.reduce((sum, c) => sum + c.amountPkr, 0);

        return (
          <div key={asset.id} className="space-y-4">
            {/* Asset Header */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">{asset.name}</h2>
                  {asset.description && <p className="text-sm text-slate-500 mt-1">{asset.description}</p>}
                </div>
                <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">{asset.assetType}</span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div>
                  <p className="text-xs text-slate-500">Total Cost</p>
                  <p className="text-sm font-semibold text-slate-900">{formatCurrency(asset.totalCost, asset.currency)}</p>
                </div>
                {asset.landValue != null && (
                  <div>
                    <p className="text-xs text-slate-500">Land Value</p>
                    <p className="text-sm font-semibold text-slate-900">{formatCurrency(asset.landValue, asset.currency)}</p>
                  </div>
                )}
                {asset.buildingValue != null && (
                  <div>
                    <p className="text-xs text-slate-500">Building Value</p>
                    <p className="text-sm font-semibold text-slate-900">{formatCurrency(asset.buildingValue, asset.currency)}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-slate-500">Acquired</p>
                  <p className="text-sm font-semibold text-slate-900">{formatDate(asset.acquisitionDate)}</p>
                </div>
                {latestDepreciation && (
                  <div>
                    <p className="text-xs text-slate-500">Book Value</p>
                    <p className="text-sm font-semibold text-slate-900">{formatCurrency(latestDepreciation.bookValue, asset.currency)}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Capital Contributions */}
            {asset.capitalContributions.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">Capital Contributions</h3>
                  <span className="text-sm text-slate-500">Total: {formatCurrency(totalCapital, "PKR")}</span>
                </div>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {asset.capitalContributions.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 text-slate-600">{formatDate(c.date)}</td>
                        <td className="px-4 py-2.5 text-slate-900">{c.description}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-slate-900">{formatCurrency(c.amountPkr, "PKR")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Additions */}
            {asset.additions.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">Additions / Improvements</h3>
                  <span className="text-sm text-slate-500">Total: {formatCurrency(totalAdditions, asset.currency)}</span>
                </div>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {asset.additions.map((a) => (
                      <tr key={a.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 text-slate-600">{formatDate(a.date)}</td>
                        <td className="px-4 py-2.5 text-slate-900">{a.description}</td>
                        <td className="px-4 py-2.5 text-slate-600">{a.vendor || "—"}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-slate-900">{formatCurrency(a.amount, a.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
