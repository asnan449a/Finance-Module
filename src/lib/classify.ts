interface ClassificationResult {
  lineOfService: string | null;
  category: string;
  status: "CLASSIFIED" | "FLAGGED" | "UNCLASSIFIED";
}

interface ClassificationRule {
  pattern: RegExp;
  lineOfService: string | null;
  category: string;
  status?: "CLASSIFIED" | "FLAGGED" | "UNCLASSIFIED";
}

const CLASSIFICATION_RULES: ClassificationRule[] = [
  // Revenue patterns
  { pattern: /stripe/i, lineOfService: "TR_BUILD", category: "Revenue" },
  { pattern: /rain\s*partners/i, lineOfService: "TR_FINANCE", category: "Revenue" },
  { pattern: /hilbash/i, lineOfService: "TR_FINANCE", category: "Revenue" },
  { pattern: /enko/i, lineOfService: "TR_FINANCE", category: "Revenue" },
  { pattern: /upwork/i, lineOfService: "TR_DEV", category: "Revenue" },
  { pattern: /marketpath/i, lineOfService: "TR_DEV", category: "Revenue" },
  { pattern: /payoneer/i, lineOfService: "TR_DEV", category: "Revenue" },
  { pattern: /limitless/i, lineOfService: "TR_DEV", category: "Revenue" },
  { pattern: /kp\s*ltd/i, lineOfService: "TR_DEV", category: "Revenue" },

  // Treasury / intercompany
  { pattern: /global\s*trans/i, lineOfService: "TREASURY", category: "Intercompany Transfer" },

  // Partner draws - flagged for review
  { pattern: /habib\s*bank.*rahim/i, lineOfService: null, category: "Partner Draw", status: "FLAGGED" },
  { pattern: /rahim.*habib/i, lineOfService: null, category: "Partner Draw", status: "FLAGGED" },

  // Corporate costs
  { pattern: /gusto/i, lineOfService: "CORPORATE", category: "Payroll" },
  { pattern: /nayatel/i, lineOfService: "CORPORATE", category: "IT Infrastructure" },

  // Wire fees
  { pattern: /wire\s*fee/i, lineOfService: "CORPORATE", category: "Wire Fee" },
  { pattern: /transfer\s*fee/i, lineOfService: "CORPORATE", category: "Wire Fee" },

  // Salary patterns
  { pattern: /cms\s*(salary|transfer)/i, lineOfService: null, category: "Salary" },
  { pattern: /ebiz\s*payroll/i, lineOfService: null, category: "Salary" },
  { pattern: /salary/i, lineOfService: null, category: "Salary" },
  { pattern: /payroll/i, lineOfService: null, category: "Payroll" },
];

export function classifyTransaction(description: string): ClassificationResult {
  const desc = description.toLowerCase();

  for (const rule of CLASSIFICATION_RULES) {
    if (rule.pattern.test(desc)) {
      return {
        lineOfService: rule.lineOfService,
        category: rule.category,
        status: rule.status || "CLASSIFIED",
      };
    }
  }

  return {
    lineOfService: null,
    category: "Other",
    status: "UNCLASSIFIED",
  };
}

export function shouldFlagFxSlippage(impliedRate: number, sbpRate: number): boolean {
  const slippage = Math.abs((impliedRate - sbpRate) / sbpRate) * 100;
  return slippage > 1.0;
}
