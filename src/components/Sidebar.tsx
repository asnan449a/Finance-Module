"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOut, useSession } from "next-auth/react";

const navItems = [
  {
    label: "Dashboard",
    href: "/",
    icon: "\u25A0", // filled square
  },
  {
    label: "Lines of Service",
    icon: "\u2630", // trigram
    children: [
      { label: "TR Build", href: "/lines/build" },
      { label: "TR Finance", href: "/lines/finance" },
      { label: "TR Dev", href: "/lines/dev" },
    ],
  },
  {
    label: "Treasury",
    href: "/treasury",
    icon: "\u2B21", // hexagon
  },
  {
    label: "Partners",
    href: "/partners",
    icon: "\u2694", // crossed swords
  },
  {
    label: "Employees",
    href: "/employees",
    icon: "\u2616", // person
  },
  {
    label: "Transactions",
    href: "/transactions",
    icon: "\u2B0C", // arrows
  },
  {
    label: "Assets",
    href: "/assets",
    icon: "\u2302", // house
  },
  {
    label: "Reports",
    href: "/reports",
    icon: "\u2637", // trigram for earth
  },
  {
    label: "Settings",
    href: "/settings",
    icon: "\u2699", // gear
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [expandedMenus, setExpandedMenus] = useState<Record<string, boolean>>({
    "Lines of Service": true,
  });

  const toggleMenu = (label: string) => {
    setExpandedMenus((prev) => ({
      ...prev,
      [label]: !prev[label],
    }));
  };

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  const isParentActive = (children: { href: string }[]) => {
    return children.some((child) => pathname.startsWith(child.href));
  };

  return (
    <aside className="flex flex-col w-64 min-h-screen bg-slate-900 text-slate-300 border-r border-slate-800">
      {/* Branding */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-800">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600 text-white font-bold text-sm">
          TR
        </div>
        <div>
          <h1 className="text-sm font-semibold text-white leading-tight">
            Telerelation LLC
          </h1>
          <p className="text-xs text-slate-500">Financial Management</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {navItems.map((item) => {
          if (item.children) {
            const parentActive = isParentActive(item.children);
            const isExpanded = expandedMenus[item.label] ?? false;

            return (
              <div key={item.label}>
                <button
                  onClick={() => toggleMenu(item.label)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    parentActive
                      ? "bg-slate-800 text-white"
                      : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <span className="text-base w-5 text-center">{item.icon}</span>
                    {item.label}
                  </span>
                  <span
                    className={`text-xs transition-transform duration-200 ${
                      isExpanded ? "rotate-90" : ""
                    }`}
                  >
                    &#9656;
                  </span>
                </button>

                {isExpanded && (
                  <div className="sidebar-submenu ml-5 mt-1 space-y-0.5 border-l border-slate-700 pl-3">
                    {item.children.map((child) => (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={`block px-3 py-2 rounded-md text-sm transition-colors ${
                          isActive(child.href)
                            ? "bg-blue-600/20 text-blue-400 font-medium"
                            : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                        }`}
                      >
                        {child.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href!}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive(item.href!)
                  ? "bg-blue-600/20 text-blue-400"
                  : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
              }`}
            >
              <span className="text-base w-5 text-center">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User section */}
      {session?.user && (
        <div className="border-t border-slate-800 px-4 py-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-700 text-white text-xs font-semibold">
              {session.user.name
                ?.split(" ")
                .map((n) => n[0])
                .join("")
                .toUpperCase() || "U"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {session.user.name}
              </p>
              <p className="text-xs text-slate-500 truncate">
                {(session.user as { role?: string }).role ?? "User"}
              </p>
            </div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            Sign Out
          </button>
        </div>
      )}
    </aside>
  );
}
