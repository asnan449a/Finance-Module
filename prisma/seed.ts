import { PrismaClient } from "@prisma/client";
import { hashSync } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // ─── Partners ──────────────────────────────────────────────────
  const rahim = await prisma.partner.create({
    data: {
      name: "Rahim Zahid",
      ownershipPct: 15,
      role: "COO",
      drawMechanism: "BoFA → HABIB Bank USD wires",
      notes: "Some wires are ASAR capex funding, not draws",
      isEmployee: true,
    },
  });

  const auraib = await prisma.partner.create({
    data: {
      name: "Auraib Zahid",
      ownershipPct: 28.33,
      role: "Partner",
      drawMechanism: "Wise multi-currency card",
      notes: "Mix of business T&E and personal expenses on Wise card",
    },
  });

  const sheraz = await prisma.partner.create({
    data: {
      name: "Sheraz",
      ownershipPct: 28.33,
      role: "Partner",
      drawMechanism: "PKR direct transfers",
      notes: "Contributed PKR 34.7M to ASAR Tower",
    },
  });

  const asnan = await prisma.partner.create({
    data: {
      name: "Asnan",
      ownershipPct: 28.33,
      role: "Partner",
      drawMechanism: "PKR direct transfers",
      notes: "Cleanest position — no current issues",
    },
  });

  // ─── Users ─────────────────────────────────────────────────────
  const passwordHash = hashSync("admin123", 10);

  await prisma.user.create({
    data: {
      email: "shaiq@telerelation.com",
      name: "Shaiq (Finance Admin)",
      passwordHash,
      role: "FINANCE_ADMIN",
    },
  });

  await prisma.user.create({
    data: {
      email: "rahim@telerelation.com",
      name: "Rahim Zahid",
      passwordHash,
      role: "COO",
      partnerId: rahim.id,
    },
  });

  await prisma.user.create({
    data: {
      email: "auraib@telerelation.com",
      name: "Auraib Zahid",
      passwordHash,
      role: "PARTNER",
      partnerId: auraib.id,
    },
  });

  await prisma.user.create({
    data: {
      email: "sheraz@telerelation.com",
      name: "Sheraz",
      passwordHash,
      role: "PARTNER",
      partnerId: sheraz.id,
    },
  });

  await prisma.user.create({
    data: {
      email: "asnan@telerelation.com",
      name: "Asnan",
      passwordHash,
      role: "PARTNER",
      partnerId: asnan.id,
    },
  });

  // ─── Bank Accounts ─────────────────────────────────────────────
  const bofa = await prisma.bankAccount.create({
    data: {
      name: "Bank of America",
      shortName: "BoFA",
      currency: "USD",
      bank: "BoFA",
      purpose: "Primary USD collection. Stripe payouts, client wires.",
      minFloat: 50000,
    },
  });

  const meezan = await prisma.bankAccount.create({
    data: {
      name: "Meezan Bank",
      shortName: "Meezan",
      currency: "PKR",
      bank: "Meezan",
      purpose: "Payroll disbursement. Receives USD wires converted to PKR.",
    },
  });

  const wiseUsd = await prisma.bankAccount.create({
    data: {
      name: "Wise USD",
      shortName: "Wise USD",
      currency: "USD",
      bank: "Wise",
      purpose: "Client receipts (Marketpath, Payoneer, Limitless)",
      cardHolder: "Auraib Zahid",
    },
  });

  const wiseGbp = await prisma.bankAccount.create({
    data: {
      name: "Wise GBP",
      shortName: "Wise GBP",
      currency: "GBP",
      bank: "Wise",
      purpose: "UK client receipts (Upwork, KP LTD)",
      cardHolder: "Auraib Zahid",
    },
  });

  const wiseEur = await prisma.bankAccount.create({
    data: {
      name: "Wise EUR",
      shortName: "Wise EUR",
      currency: "EUR",
      bank: "Wise",
      purpose: "Minor EUR receipts, swept monthly",
      cardHolder: "Auraib Zahid",
    },
  });

  const wiseChf = await prisma.bankAccount.create({
    data: {
      name: "Wise CHF",
      shortName: "Wise CHF",
      currency: "CHF",
      bank: "Wise",
      purpose: "Minor CHF receipts, swept monthly",
      cardHolder: "Auraib Zahid",
    },
  });

  // ─── Account Balances (end of 2025) ────────────────────────────
  const endOf2025 = new Date("2025-12-31");
  await prisma.accountBalance.createMany({
    data: [
      { accountId: bofa.id, date: endOf2025, balance: 50017.09, currency: "USD", balancePkr: 14054804 },
      { accountId: meezan.id, date: endOf2025, balance: 2905197.51, currency: "PKR", balancePkr: 2905197.51 },
      { accountId: wiseUsd.id, date: endOf2025, balance: 12500, currency: "USD", balancePkr: 3512500 },
      { accountId: wiseGbp.id, date: endOf2025, balance: 3200, currency: "GBP", balancePkr: 1139200 },
      { accountId: wiseEur.id, date: endOf2025, balance: 850, currency: "EUR", balancePkr: 263500 },
      { accountId: wiseChf.id, date: endOf2025, balance: 200, currency: "CHF", balancePkr: 65200 },
    ],
  });

  // ─── Clients ───────────────────────────────────────────────────
  await prisma.client.createMany({
    data: [
      // TR Build
      { name: "Tameer NYC", lineOfService: "TR_BUILD", paymentChannel: "Stripe", currency: "USD", billingPattern: "Monthly invoices, project milestones" },
      // TR Finance
      { name: "Rain Partners", lineOfService: "TR_FINANCE", paymentChannel: "Bill.com (ACH)", currency: "USD", billingPattern: "Monthly recurring" },
      { name: "HILBASH Investments", lineOfService: "TR_FINANCE", paymentChannel: "Bill.com (ACH)", currency: "USD", billingPattern: "Monthly recurring" },
      { name: "Enko Fund Managers", lineOfService: "TR_FINANCE", paymentChannel: "Wire", currency: "USD", billingPattern: "Quarterly" },
      { name: "Roderick McCarthy", lineOfService: "TR_FINANCE", paymentChannel: "Zelle", currency: "USD", billingPattern: "Ad hoc" },
      // TR Dev
      { name: "Upwork Clients", lineOfService: "TR_DEV", paymentChannel: "Upwork", currency: "USD", billingPattern: "Project milestones" },
      { name: "KP LTD", lineOfService: "TR_DEV", paymentChannel: "Wise GBP", currency: "GBP", billingPattern: "Recurring" },
      { name: "MARKETPATH INC", lineOfService: "TR_DEV", paymentChannel: "Wise USD", currency: "USD", billingPattern: "Recurring" },
      { name: "PAYONEER Clients", lineOfService: "TR_DEV", paymentChannel: "Payoneer → Wise", currency: "USD", billingPattern: "Variable" },
      { name: "LIMITLESS HQ", lineOfService: "TR_DEV", paymentChannel: "Wise USD", currency: "USD", billingPattern: "Recurring" },
    ],
  });

  // ─── Employees ─────────────────────────────────────────────────
  const employees = [
    // TR Build
    { name: "Ahmad Raza", department: "TR_BUILD", pkrBaseSalary: 150000, startDate: new Date("2024-01-15") },
    { name: "Bilal Khan", department: "TR_BUILD", pkrBaseSalary: 180000, startDate: new Date("2024-03-01") },
    { name: "Farhan Ali", department: "TR_BUILD", pkrBaseSalary: 200000, startDate: new Date("2023-06-01") },
    { name: "Tariq Mehmood", department: "TR_BUILD", pkrBaseSalary: 120000, startDate: new Date("2024-07-01") },
    { name: "Zain Abbas", department: "TR_BUILD", pkrBaseSalary: 160000, startDate: new Date("2024-02-15") },
    // TR Finance
    { name: "Saad Hussain", department: "TR_FINANCE", pkrBaseSalary: 250000, usdSupplement: 500, bankName: "Meezan", startDate: new Date("2023-01-10") },
    { name: "Areesha Asif", department: "TR_FINANCE", pkrBaseSalary: 200000, usdSupplement: 400, bankName: "Alfalah", startDate: new Date("2023-04-01") },
    { name: "Hassan Malik", department: "TR_FINANCE", pkrBaseSalary: 180000, startDate: new Date("2024-01-01") },
    { name: "Nida Fatima", department: "TR_FINANCE", pkrBaseSalary: 150000, startDate: new Date("2024-06-01") },
    // TR Dev
    { name: "Awais Ahmed", department: "TR_DEV", pkrBaseSalary: 300000, usdSupplement: 800, bankName: "Habib", startDate: new Date("2022-06-01") },
    { name: "Usama Maood", department: "TR_DEV", pkrBaseSalary: 280000, usdSupplement: 700, bankName: "Meezan", startDate: new Date("2022-09-01") },
    { name: "Awais Ather", department: "TR_DEV", pkrBaseSalary: 250000, usdSupplement: 600, bankName: "Standard Chartered", startDate: new Date("2023-02-01") },
    { name: "Shaheer Haider", department: "TR_DEV", pkrBaseSalary: 220000, usdSupplement: 500, bankName: "Alfalah", startDate: new Date("2023-05-15") },
    { name: "Usman Tariq", department: "TR_DEV", pkrBaseSalary: 200000, startDate: new Date("2024-01-01") },
    { name: "Hamza Rashid", department: "TR_DEV", pkrBaseSalary: 180000, startDate: new Date("2024-03-15") },
    { name: "Ali Hassan", department: "TR_DEV", pkrBaseSalary: 170000, startDate: new Date("2024-05-01") },
    { name: "Kamran Shah", department: "TR_DEV", pkrBaseSalary: 160000, startDate: new Date("2024-07-01") },
    { name: "Imran Siddiqui", department: "TR_DEV", pkrBaseSalary: 150000, startDate: new Date("2024-09-01") },
    { name: "Waqas Javed", department: "TR_DEV", pkrBaseSalary: 140000, startDate: new Date("2024-11-01") },
    // Corporate
    { name: "Shaiq Ahmed", department: "CORPORATE", pkrBaseSalary: 200000, startDate: new Date("2023-01-01") },
    { name: "Maria Khan", department: "CORPORATE", pkrBaseSalary: 150000, startDate: new Date("2023-06-01") },
    { name: "Saba Noor", department: "CORPORATE", pkrBaseSalary: 130000, startDate: new Date("2024-01-01") },
    { name: "Faizan Iqbal", department: "CORPORATE", pkrBaseSalary: 120000, startDate: new Date("2024-03-01") },
    { name: "Rabia Aziz", department: "CORPORATE", pkrBaseSalary: 100000, startDate: new Date("2024-06-01") },
  ];

  for (const emp of employees) {
    await prisma.employee.create({ data: emp });
  }

  // ─── Overhead Categories ───────────────────────────────────────
  await prisma.overheadCategory.createMany({
    data: [
      { name: "Finance & Accounting Staff", annualAmountPkr: 3000000, allocationBasis: "EQUAL" },
      { name: "HR / Admin Staff", annualAmountPkr: 2400000, allocationBasis: "HEADCOUNT" },
      { name: "Office Rent (Lahore)", annualAmountPkr: 10449850, allocationBasis: "HEADCOUNT" },
      { name: "IT Infrastructure (Nayatel etc.)", annualAmountPkr: 1500000, allocationBasis: "HEADCOUNT" },
      { name: "Marketing & BD", annualAmountPkr: 700000, allocationBasis: "REVENUE_SHARE" },
      { name: "Legal / Compliance / Tax", annualAmountPkr: 1000000, allocationBasis: "EQUAL" },
    ],
  });

  // ─── Fixed Assets (ASAR Tower) ─────────────────────────────────
  const asarTower = await prisma.fixedAsset.create({
    data: {
      name: "ASAR Islamabad Tower",
      description: "Real property acquired April–October 2025. Land + building.",
      assetType: "Real Property",
      acquisitionDate: new Date("2025-04-01"),
      totalCost: 94833357.44,
      currency: "PKR",
      landValue: 40000000,
      buildingValue: 54833357.44,
      usefulLifeYears: 30,
      depreciationMethod: "STRAIGHT_LINE",
      isCapitalized: true,
    },
  });

  // Asset additions
  await prisma.assetAddition.createMany({
    data: [
      { assetId: asarTower.id, date: new Date("2025-07-15"), description: "Architecture fees (Illsutarc)", amount: 297000, vendor: "Illsutarc" },
      { assetId: asarTower.id, date: new Date("2025-08-01"), description: "Architecture fees (Illsutarc) - Phase 2", amount: 330000, vendor: "Illsutarc" },
      { assetId: asarTower.id, date: new Date("2025-06-20"), description: "Soil testing", amount: 70000, vendor: "Sultan Engineering" },
      { assetId: asarTower.id, date: new Date("2025-09-10"), description: "IBECHS/CDA fees", amount: 265000, vendor: "IBECHS/CDA" },
      { assetId: asarTower.id, date: new Date("2025-05-05"), description: "Stamp paper", amount: 4000, vendor: "Govt" },
    ],
  });

  // Capital contributions
  await prisma.capitalAccount.createMany({
    data: [
      { partnerId: sheraz.id, date: new Date("2025-04-15"), amount: 34700000, currency: "PKR", amountPkr: 34700000, description: "ASAR Tower contribution", assetId: asarTower.id },
      { partnerId: auraib.id, date: new Date("2025-05-01"), amount: 13000000, currency: "PKR", amountPkr: 13000000, description: "ASAR Tower contribution", assetId: asarTower.id },
    ],
  });

  // Company funding contributions to ASAR
  // These go as corporate capital, tracked separately
  await prisma.capitalAccount.createMany({
    data: [
      { partnerId: rahim.id, date: new Date("2025-06-01"), amount: 0, currency: "PKR", amountPkr: 0, description: "ASAR Tower - Telerelation BoFA contribution (company funds, not personal)" },
    ],
  });

  // ─── Sample Transactions (2025 Revenue) ────────────────────────
  const fxRate = 281.03;

  // TR Build - Stripe revenue (Tameer NYC)
  const stripeMonths = [
    { month: "2025-01", amount: 35000 }, { month: "2025-02", amount: 38000 },
    { month: "2025-03", amount: 42000 }, { month: "2025-04", amount: 36000 },
    { month: "2025-05", amount: 40000 }, { month: "2025-06", amount: 45000 },
    { month: "2025-07", amount: 38000 }, { month: "2025-08", amount: 35000 },
    { month: "2025-09", amount: 42000 }, { month: "2025-10", amount: 39000 },
    { month: "2025-11", amount: 33852.42 }, { month: "2025-12", amount: 31000 },
  ];

  for (const s of stripeMonths) {
    await prisma.transaction.create({
      data: {
        date: new Date(`${s.month}-15`),
        accountId: bofa.id,
        amount: s.amount,
        currency: "USD",
        amountPkr: s.amount * fxRate,
        direction: "credit",
        description: `Stripe deposit - Tameer NYC - ${s.month}`,
        lineOfService: "TR_BUILD",
        category: "Revenue",
        clientOrVendor: "Tameer NYC",
        status: "CLASSIFIED",
      },
    });
  }

  // TR Finance - Rain Partners
  for (let m = 1; m <= 12; m++) {
    const month = String(m).padStart(2, "0");
    await prisma.transaction.create({
      data: {
        date: new Date(`2025-${month}-05`),
        accountId: bofa.id,
        amount: 4932.67,
        currency: "USD",
        amountPkr: 4932.67 * fxRate,
        direction: "credit",
        description: `Rain Partners - Monthly retainer - 2025-${month}`,
        lineOfService: "TR_FINANCE",
        category: "Revenue",
        clientOrVendor: "Rain Partners",
        status: "CLASSIFIED",
      },
    });
  }

  // TR Finance - HILBASH
  for (let m = 1; m <= 12; m++) {
    const month = String(m).padStart(2, "0");
    await prisma.transaction.create({
      data: {
        date: new Date(`2025-${month}-10`),
        accountId: bofa.id,
        amount: 2780.42,
        currency: "USD",
        amountPkr: 2780.42 * fxRate,
        direction: "credit",
        description: `HILBASH Investments - Monthly retainer - 2025-${month}`,
        lineOfService: "TR_FINANCE",
        category: "Revenue",
        clientOrVendor: "HILBASH Investments",
        status: "CLASSIFIED",
      },
    });
  }

  // TR Finance - Enko Fund (quarterly)
  for (const q of ["03", "06", "09", "12"]) {
    await prisma.transaction.create({
      data: {
        date: new Date(`2025-${q}-28`),
        accountId: bofa.id,
        amount: 6454.10,
        currency: "USD",
        amountPkr: 6454.10 * fxRate,
        direction: "credit",
        description: `Enko Fund Managers - Quarterly advisory - 2025-Q${Math.ceil(parseInt(q) / 3)}`,
        lineOfService: "TR_FINANCE",
        category: "Revenue",
        clientOrVendor: "Enko Fund Managers",
        status: "CLASSIFIED",
      },
    });
  }

  // TR Dev - Upwork
  const upworkTxns = [
    { date: "2025-02-15", amount: 1200, currency: "USD" },
    { date: "2025-04-10", amount: 1800, currency: "USD" },
    { date: "2025-06-20", amount: 2100, currency: "USD" },
    { date: "2025-08-05", amount: 1563.06, currency: "USD" },
    { date: "2025-10-25", amount: 1500, currency: "USD" },
    { date: "2025-12-15", amount: 2000, currency: "USD" },
  ];
  for (const t of upworkTxns) {
    await prisma.transaction.create({
      data: {
        date: new Date(t.date),
        accountId: t.currency === "USD" ? bofa.id : wiseGbp.id,
        amount: t.amount,
        currency: t.currency,
        amountPkr: t.amount * (t.currency === "GBP" ? 355.75 : fxRate),
        direction: "credit",
        description: `Upwork escrow release`,
        lineOfService: "TR_DEV",
        category: "Revenue",
        clientOrVendor: "Upwork",
        status: "CLASSIFIED",
      },
    });
  }

  // TR Dev - Wise USD clients
  const wiseUsdTxns = [
    { date: "2025-01-20", amount: 3200, client: "MARKETPATH INC" },
    { date: "2025-02-20", amount: 3200, client: "MARKETPATH INC" },
    { date: "2025-03-20", amount: 3200, client: "MARKETPATH INC" },
    { date: "2025-04-20", amount: 3200, client: "MARKETPATH INC" },
    { date: "2025-05-20", amount: 3200, client: "MARKETPATH INC" },
    { date: "2025-06-20", amount: 3200, client: "MARKETPATH INC" },
    { date: "2025-07-20", amount: 3200, client: "MARKETPATH INC" },
    { date: "2025-08-20", amount: 3200, client: "MARKETPATH INC" },
    { date: "2025-09-20", amount: 3200, client: "MARKETPATH INC" },
    { date: "2025-10-20", amount: 3200, client: "MARKETPATH INC" },
    { date: "2025-11-20", amount: 3200, client: "MARKETPATH INC" },
    { date: "2025-12-20", amount: 3142.95, client: "MARKETPATH INC" },
    { date: "2025-03-10", amount: 2500, client: "LIMITLESS HQ" },
    { date: "2025-06-10", amount: 2500, client: "LIMITLESS HQ" },
    { date: "2025-09-10", amount: 2500, client: "LIMITLESS HQ" },
    { date: "2025-12-10", amount: 2500, client: "LIMITLESS HQ" },
  ];
  for (const t of wiseUsdTxns) {
    await prisma.transaction.create({
      data: {
        date: new Date(t.date),
        accountId: wiseUsd.id,
        amount: t.amount,
        currency: "USD",
        amountPkr: t.amount * fxRate,
        direction: "credit",
        description: `${t.client} - payment`,
        lineOfService: "TR_DEV",
        category: "Revenue",
        clientOrVendor: t.client,
        status: "CLASSIFIED",
      },
    });
  }

  // TR Dev - Wise GBP (KP LTD)
  for (let m = 1; m <= 12; m++) {
    const month = String(m).padStart(2, "0");
    await prisma.transaction.create({
      data: {
        date: new Date(`2025-${month}-25`),
        accountId: wiseGbp.id,
        amount: 1372.78,
        currency: "GBP",
        amountPkr: 1372.78 * 355.75,
        direction: "credit",
        description: `KP LTD - Monthly recurring - 2025-${month}`,
        lineOfService: "TR_DEV",
        category: "Revenue",
        clientOrVendor: "KP LTD",
        status: "CLASSIFIED",
      },
    });
  }

  // ─── FX Conversions (13 wires in 2025) ─────────────────────────
  const fxConversions = [
    { date: "2025-01-15", sent: 35000, received: 9835000, rate: 281.00 },
    { date: "2025-02-18", sent: 38000, received: 10679400, rate: 281.04 },
    { date: "2025-03-12", sent: 40000, received: 11148000, rate: 278.70 },
    { date: "2025-04-16", sent: 35000, received: 9868000, rate: 281.94 },
    { date: "2025-05-14", sent: 42000, received: 11831280, rate: 281.70 },
    { date: "2025-06-11", sent: 38000, received: 10660800, rate: 280.55 },
    { date: "2025-07-09", sent: 35000, received: 9916900, rate: 283.34 },
    { date: "2025-08-13", sent: 40000, received: 11256000, rate: 281.40 },
    { date: "2025-09-10", sent: 36000, received: 10029600, rate: 278.60 },
    { date: "2025-10-15", sent: 38000, received: 10701880, rate: 281.63 },
    { date: "2025-11-12", sent: 42000, received: 11820960, rate: 281.45 },
    { date: "2025-12-10", sent: 55844.54, received: 15662787.26, rate: 280.51 },
    { date: "2025-12-20", sent: 42000, received: 11872680, rate: 282.68 },
  ];

  for (const fx of fxConversions) {
    const sbpRate = fx.rate + (Math.random() * 2 - 1); // simulate SBP rate near implied
    const slippage = Math.abs((fx.rate - sbpRate) / sbpRate) * 100;
    await prisma.fxConversion.create({
      data: {
        date: new Date(fx.date),
        amountSent: fx.sent,
        wireFee: 45,
        amountReceived: fx.received,
        impliedRate: fx.rate,
        sbpRate: Math.round(sbpRate * 100) / 100,
        slippage: Math.round(slippage * 100) / 100,
        isFlagged: slippage > 1.0,
        referenceCode: `${new Date(fx.date).toLocaleString("en-US", { month: "short" }).toUpperCase()}-PAYROLL`,
      },
    });
  }

  // ─── Sample Wire Fee Transactions ──────────────────────────────
  for (const fx of fxConversions) {
    await prisma.transaction.create({
      data: {
        date: new Date(fx.date),
        accountId: bofa.id,
        amount: 45,
        currency: "USD",
        amountPkr: 45 * fxRate,
        direction: "debit",
        description: `Wire transfer fee - BoFA to Meezan`,
        lineOfService: "CORPORATE",
        category: "Wire Fee",
        status: "CLASSIFIED",
      },
    });
  }

  // ─── Salary Transactions (monthly payroll) ─────────────────────
  for (let m = 1; m <= 12; m++) {
    const month = String(m).padStart(2, "0");

    // CMS salary transfers (~PKR 2.8M/month)
    await prisma.transaction.create({
      data: {
        date: new Date(`2025-${month}-28`),
        accountId: meezan.id,
        amount: 2807811.25,
        currency: "PKR",
        amountPkr: 2807811.25,
        direction: "debit",
        description: `CMS salary transfers - ${month}/2025`,
        lineOfService: "CORPORATE",
        category: "Salary",
        status: "CLASSIFIED",
      },
    });

    // eBiz payroll (~PKR 7.3M/month)
    await prisma.transaction.create({
      data: {
        date: new Date(`2025-${month}-28`),
        accountId: meezan.id,
        amount: 7297567.42,
        currency: "PKR",
        amountPkr: 7297567.42,
        direction: "debit",
        description: `eBiz payroll batch - ${month}/2025`,
        lineOfService: "CORPORATE",
        category: "Salary",
        status: "CLASSIFIED",
      },
    });
  }

  // ─── Partner Draws (sample) ────────────────────────────────────
  // Rahim - BoFA to HABIB Bank wires
  await prisma.partnerDraw.createMany({
    data: [
      { partnerId: rahim.id, date: new Date("2025-03-15"), amount: 5000, currency: "USD", amountPkr: 5000 * fxRate, description: "BoFA wire to HABIB Bank", category: "Wire Transfer", period: "2025-H1" },
      { partnerId: rahim.id, date: new Date("2025-06-10"), amount: 5000, currency: "USD", amountPkr: 5000 * fxRate, description: "BoFA wire to HABIB Bank", category: "Wire Transfer", period: "2025-H1" },
      { partnerId: rahim.id, date: new Date("2025-09-20"), amount: 5000, currency: "USD", amountPkr: 5000 * fxRate, description: "BoFA wire to HABIB Bank", category: "Wire Transfer", period: "2025-H2" },
    ],
  });

  // Auraib - Wise card personal spend
  await prisma.partnerDraw.createMany({
    data: [
      { partnerId: auraib.id, date: new Date("2025-02-10"), amount: 1200, currency: "USD", amountPkr: 1200 * fxRate, description: "Wise card - personal purchase", category: "Card Spend", period: "2025-H1" },
      { partnerId: auraib.id, date: new Date("2025-05-15"), amount: 800, currency: "USD", amountPkr: 800 * fxRate, description: "Wise card - personal purchase", category: "Card Spend", period: "2025-H1" },
      { partnerId: auraib.id, date: new Date("2025-08-20"), amount: 1500, currency: "USD", amountPkr: 1500 * fxRate, description: "Wise card - personal purchase", category: "Card Spend", period: "2025-H2" },
      { partnerId: auraib.id, date: new Date("2025-11-05"), amount: 950, currency: "USD", amountPkr: 950 * fxRate, description: "Wise card - personal purchase", category: "Card Spend", period: "2025-H2" },
    ],
  });

  // Sheraz - PKR transfers
  await prisma.partnerDraw.createMany({
    data: [
      { partnerId: sheraz.id, date: new Date("2025-04-01"), amount: 500000, currency: "PKR", amountPkr: 500000, description: "PKR direct transfer", category: "Direct Transfer", period: "2025-H1" },
      { partnerId: sheraz.id, date: new Date("2025-10-15"), amount: 750000, currency: "PKR", amountPkr: 750000, description: "PKR direct transfer", category: "Direct Transfer", period: "2025-H2" },
    ],
  });

  // ─── Company Settings ──────────────────────────────────────────
  const settings = [
    { key: "company_name", value: "Telerelation LLC" },
    { key: "distribution_frequency", value: "SEMI_ANNUAL" },
    { key: "distribution_dates", value: "06-30,12-31" },
    { key: "bofa_min_float", value: "50000" },
    { key: "fx_slippage_threshold", value: "1.0" },
    { key: "wire_fee_usd", value: "45" },
    { key: "default_fx_rate", value: "281.03" },
    { key: "asar_capitalize", value: "true" },
  ];

  for (const s of settings) {
    await prisma.companySetting.create({ data: s });
  }

  console.log("Seed completed successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
