"use client";

import { useEffect, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/format";
import { TRANSACTION_CATEGORIES, TRANSACTION_STATUSES, LINES_OF_SERVICE, UNIT_LABELS } from "@/lib/constants";

interface Transaction {
  id: string;
  date: string;
  amount: number;
  currency: string;
  amountPkr: number;
  direction: string;
  description: string;
  lineOfService: string | null;
  category: string | null;
  clientOrVendor: string | null;
  status: string;
  account: {
    id: string;
    name: string;
    shortName: string;
    currency: string;
    bank: string;
  };
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [lineOfService, setLineOfService] = useState("");
  const [page, setPage] = useState(1);

  const fetchTransactions = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (category) params.set("category", category);
    if (status) params.set("status", status);
    if (lineOfService) params.set("lineOfService", lineOfService);
    params.set("page", String(page));
    params.set("limit", "25");

    fetch(`/api/transactions?${params}`)
      .then((res) => res.json())
      .then((data) => {
        setTransactions(data.transactions || []);
        setPagination(data.pagination || null);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, category, status, lineOfService]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchTransactions();
  };

  const statusColor = (s: string) => {
    switch (s) {
      case "CLASSIFIED": return "bg-green-100 text-green-700";
      case "RECONCILED": return "bg-blue-100 text-blue-700";
      case "FLAGGED": return "bg-red-100 text-red-700";
      default: return "bg-amber-100 text-amber-700";
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Transactions</h1>
        <p className="text-sm text-slate-500 mt-1">View and manage all financial transactions</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <form onSubmit={handleSearch} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-slate-500 mb-1">Search</label>
            <input
              type="text"
              placeholder="Search description, client..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Category</label>
            <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} className="px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">All Categories</option>
              {TRANSACTION_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">All Statuses</option>
              {TRANSACTION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Line of Service</label>
            <select value={lineOfService} onChange={(e) => { setLineOfService(e.target.value); setPage(1); }} className="px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">All Lines</option>
              {LINES_OF_SERVICE.map((l) => <option key={l} value={l}>{UNIT_LABELS[l]}</option>)}
            </select>
          </div>
          <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            Search
          </button>
        </form>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-slate-400">Loading...</div>
        ) : transactions.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-slate-400">No transactions found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Description</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Account</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Category</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Line</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase">Amount</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase">PKR</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-slate-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.map((txn) => (
                  <tr key={txn.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{formatDate(txn.date)}</td>
                    <td className="px-4 py-3 text-slate-900 font-medium max-w-[250px] truncate">{txn.description}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{txn.account.shortName}</td>
                    <td className="px-4 py-3 text-slate-600">{txn.category || "—"}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{txn.lineOfService ? (UNIT_LABELS[txn.lineOfService] || txn.lineOfService) : "—"}</td>
                    <td className={`px-4 py-3 text-right whitespace-nowrap font-medium ${txn.direction === "CREDIT" ? "text-green-600" : "text-red-600"}`}>
                      {txn.direction === "CREDIT" ? "+" : "-"}{formatCurrency(txn.amount, txn.currency)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500 whitespace-nowrap">{formatCurrency(txn.amountPkr, "PKR")}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(txn.status)}`}>
                        {txn.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50">
            <p className="text-sm text-slate-500">
              Showing {(pagination.page - 1) * pagination.limit + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                disabled={page === pagination.totalPages}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
