export const LINES_OF_SERVICE = ["TR_BUILD", "TR_FINANCE", "TR_DEV"] as const;
export const ALL_UNITS = ["TR_BUILD", "TR_FINANCE", "TR_DEV", "CORPORATE", "TREASURY"] as const;

export const UNIT_LABELS: Record<string, string> = {
  TR_BUILD: "TR Build",
  TR_FINANCE: "TR Finance",
  TR_DEV: "TR Dev",
  CORPORATE: "Corporate",
  TREASURY: "Treasury",
};

export const CURRENCIES = ["USD", "PKR", "GBP", "EUR", "CHF"] as const;

export const TRANSACTION_CATEGORIES = [
  "Revenue",
  "Salary",
  "Rent",
  "Travel",
  "Tools",
  "Wire Fee",
  "FX",
  "Partner Draw",
  "Capex",
  "Intercompany Transfer",
  "Payroll",
  "IT Infrastructure",
  "Operating Expense",
  "Other",
] as const;

export const TRANSACTION_STATUSES = ["CLASSIFIED", "UNCLASSIFIED", "FLAGGED", "RECONCILED"] as const;

export const PARTNERS = {
  RAHIM: { name: "Rahim Zahid", ownership: 15 },
  AURAIB: { name: "Auraib Zahid", ownership: 28.33 },
  SHERAZ: { name: "Sheraz", ownership: 28.33 },
  ASNAN: { name: "Asnan", ownership: 28.33 },
} as const;

export const ROLES = ["FINANCE_ADMIN", "PARTNER", "COO", "HR", "AUDITOR"] as const;

export const ALLOCATION_BASES = ["EQUAL", "HEADCOUNT", "REVENUE_SHARE"] as const;

export const BOFA_MIN_FLOAT = 50000;
export const WIRE_FEE_USD = 45;
export const FX_SLIPPAGE_THRESHOLD = 1.0; // percent

export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  PKR: "₨",
  GBP: "£",
  EUR: "€",
  CHF: "CHF",
};
