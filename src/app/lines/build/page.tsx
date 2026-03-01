"use client";

import { useEffect, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/format";

interface Transaction {
  id: string;
  date: string;
  amount: number;
  currency: string;
  amountPkr: number;
  direction: string;
  description: string;
  category: string | null;
  clientOrVendor: string | null;
  status: string;
  account: { shortName: string; currency: string };
}

interface LineData {
  transactions: Transaction[];
  pagination: { total: number; totalPages: number; page: number };
}

export default function TRBuildPage() {
  const [data, setData] = useState<LineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetch(`/api/transactions?lineOfService=TR_BUILD&page=${page}&limit=25`)
      .then((res) => res.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [page]);

  const revenue = data?.transactions.filter((t) => t.direction === "CREDIT").reduce((s, t) => s + t.amountPkr, 0) || 0;
  const expenses = data?.transactions.filter((t) => t.direction === "DEBIT").reduce((s, t) => s + t.amountPkr, 0) || 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">TR Build</h1>
        <p className="text-sm text-slate-500 mt-1">Real estate development and construction services</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500 uppercase">Total Transactions</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{data?.pagination.total || 0}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500 uppercase">Revenue (Page)</p>
          <p className="text-2xl font-bold text-green-600 mt-1">{formatCurrency(revenue, "PKR")}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500 uppercase">Expenses (Page)</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{formatCurrency(expenses, "PKR")}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-slate-400">Loading...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Description</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Client/Vendor</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Category</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase">Amount</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-slate-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data?.transactions.map((txn) => (
                  <tr key={txn.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{formatDate(txn.date)}</td>
                    <td className="px-4 py-3 text-slate-900 font-medium max-w-[250px] truncate">{txn.description}</td>
                    <td className="px-4 py-3 text-slate-600">{txn.clientOrVendor || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{txn.category || "—"}</td>
                    <td className={`px-4 py-3 text-right font-medium whitespace-nowrap ${txn.direction === "CREDIT" ? "text-green-600" : "text-red-600"}`}>
                      {txn.direction === "CREDIT" ? "+" : "-"}{formatCurrency(txn.amount, txn.currency)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        txn.status === "CLASSIFIED" ? "bg-green-100 text-green-700" :
                        txn.status === "FLAGGED" ? "bg-red-100 text-red-700" :
                        "bg-amber-100 text-amber-700"
                      }`}>
                        {txn.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50">
            <p className="text-sm text-slate-500">Page {page} of {data.pagination.totalPages}</p>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm disabled:opacity-40">Previous</button>
              <button onClick={() => setPage((p) => p + 1)} disabled={page >= data.pagination.totalPages} className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
