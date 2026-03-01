"use client";

import { useEffect, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/format";
import { UNIT_LABELS, ALL_UNITS } from "@/lib/constants";

interface SplitAllocation {
  id: string;
  department: string;
  percentage: number;
}

interface Employee {
  id: string;
  name: string;
  department: string;
  pkrBaseSalary: number;
  usdSupplement: number | null;
  bankName: string | null;
  bankAccount: string | null;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  notes: string | null;
  splitAllocations: SplitAllocation[];
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [departmentFilter, setDepartmentFilter] = useState("");

  useEffect(() => {
    const params = new URLSearchParams();
    if (departmentFilter) params.set("department", departmentFilter);
    params.set("isActive", "true");

    fetch(`/api/employees?${params}`)
      .then((res) => res.json())
      .then(setEmployees)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [departmentFilter]);

  const totalPayroll = employees.reduce((sum, e) => sum + e.pkrBaseSalary, 0);
  const totalUsdSupp = employees.reduce((sum, e) => sum + (e.usdSupplement || 0), 0);

  const deptCounts: Record<string, number> = {};
  employees.forEach((e) => {
    deptCounts[e.department] = (deptCounts[e.department] || 0) + 1;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Employees</h1>
        <p className="text-sm text-slate-500 mt-1">Team members, salaries, and cost allocations</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500 uppercase">Total Headcount</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{employees.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500 uppercase">Monthly Payroll (PKR)</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{formatCurrency(totalPayroll, "PKR")}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500 uppercase">USD Supplements</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{formatCurrency(totalUsdSupp, "USD")}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500 uppercase">Departments</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {Object.entries(deptCounts).map(([dept, count]) => (
              <span key={dept} className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600">
                {UNIT_LABELS[dept] || dept}: {count}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        <button
          onClick={() => setDepartmentFilter("")}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            !departmentFilter ? "bg-blue-600 text-white" : "bg-white border border-slate-300 text-slate-600 hover:bg-slate-50"
          }`}
        >
          All
        </button>
        {ALL_UNITS.filter(u => u !== "TREASURY").map((dept) => (
          <button
            key={dept}
            onClick={() => setDepartmentFilter(dept)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              departmentFilter === dept ? "bg-blue-600 text-white" : "bg-white border border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {UNIT_LABELS[dept] || dept}
          </button>
        ))}
      </div>

      {/* Employee Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-slate-400">Loading...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Department</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase">PKR Salary</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase">USD Supp.</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Start Date</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Bank</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Allocation Split</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {employees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{emp.name}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600">
                        {UNIT_LABELS[emp.department] || emp.department}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-900 whitespace-nowrap">{formatCurrency(emp.pkrBaseSalary, "PKR")}</td>
                    <td className="px-4 py-3 text-right text-slate-600 whitespace-nowrap">
                      {emp.usdSupplement ? formatCurrency(emp.usdSupplement, "USD") : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{formatDate(emp.startDate)}</td>
                    <td className="px-4 py-3 text-slate-600">{emp.bankName || "—"}</td>
                    <td className="px-4 py-3">
                      {emp.splitAllocations.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {emp.splitAllocations.map((alloc) => (
                            <span key={alloc.id} className="px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-700">
                              {UNIT_LABELS[alloc.department] || alloc.department}: {alloc.percentage}%
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400 text-xs">100% {UNIT_LABELS[emp.department] || emp.department}</span>
                      )}
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
