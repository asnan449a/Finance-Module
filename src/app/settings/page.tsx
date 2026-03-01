"use client";

import { useSession } from "next-auth/react";
import { BOFA_MIN_FLOAT, WIRE_FEE_USD, FX_SLIPPAGE_THRESHOLD, PARTNERS } from "@/lib/constants";
import { formatCurrency, formatPercent } from "@/lib/format";

export default function SettingsPage() {
  const { data: session } = useSession();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500 mt-1">System configuration and business rules</p>
      </div>

      {/* Current User */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">Current User</h2>
        {session?.user ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-slate-500">Name</p>
              <p className="text-sm font-medium text-slate-900">{session.user.name}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Email</p>
              <p className="text-sm font-medium text-slate-900">{session.user.email}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Role</p>
              <p className="text-sm font-medium text-slate-900">{(session.user as { role?: string }).role || "User"}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-400">Not logged in</p>
        )}
      </div>

      {/* Business Rules */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">Business Rules</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2 border-b border-slate-100">
            <div>
              <p className="text-sm text-slate-900">BoFA Minimum Float</p>
              <p className="text-xs text-slate-500">Minimum balance required in Bank of America account</p>
            </div>
            <span className="text-sm font-semibold text-slate-900">{formatCurrency(BOFA_MIN_FLOAT, "USD")}</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-slate-100">
            <div>
              <p className="text-sm text-slate-900">Wire Transfer Fee</p>
              <p className="text-xs text-slate-500">Standard wire fee for USD transfers</p>
            </div>
            <span className="text-sm font-semibold text-slate-900">{formatCurrency(WIRE_FEE_USD, "USD")}</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm text-slate-900">FX Slippage Threshold</p>
              <p className="text-xs text-slate-500">Flag FX conversions with slippage above this threshold</p>
            </div>
            <span className="text-sm font-semibold text-slate-900">{formatPercent(FX_SLIPPAGE_THRESHOLD)}</span>
          </div>
        </div>
      </div>

      {/* Partner Ownership */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">Partner Ownership Configuration</h2>
        <div className="space-y-2">
          {Object.entries(PARTNERS).map(([key, partner]) => (
            <div key={key} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
              <span className="text-sm text-slate-900">{partner.name}</span>
              <span className="text-sm font-semibold text-slate-900">{formatPercent(partner.ownership)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Test Credentials */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-amber-800 mb-3">Test Credentials</h2>
        <div className="space-y-2 text-sm text-amber-700">
          <div className="flex gap-4">
            <span className="font-medium min-w-[180px]">admin@telerelation.com</span>
            <span>admin123</span>
            <span className="text-amber-500">(Finance Admin)</span>
          </div>
          <div className="flex gap-4">
            <span className="font-medium min-w-[180px]">rahim@telerelation.com</span>
            <span>admin123</span>
            <span className="text-amber-500">(Partner)</span>
          </div>
          <div className="flex gap-4">
            <span className="font-medium min-w-[180px]">auraib@telerelation.com</span>
            <span>admin123</span>
            <span className="text-amber-500">(Partner)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
