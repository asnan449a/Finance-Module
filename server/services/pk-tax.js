import { asMoney, normalizeEntity } from './fx.js';

export const PK_EXPENSE_TAX_TREATMENTS = [
  'DEDUCTIBLE',
  'NON_DEDUCTIBLE',
  'PARTIALLY_DEDUCTIBLE',
  'PAYROLL',
  'CAPITAL'
];

export function buildDefaultPkTaxSettings() {
  return {
    entityType: 'PVT_LTD',
    payrollEnabled: true,
    payrollFrequency: 'MONTHLY',
    withholdingSection: '149',
    taxYearLabel: 'TY2026',
    deductibilityDefaults: {
      defaultExpenseTreatment: 'DEDUCTIBLE',
      payrollTreatment: 'PAYROLL'
    },
    salaryComponents: [
      { key: 'basicPay', label: 'Basic pay', taxable: true, includedInGross: true },
      { key: 'allowances', label: 'Allowances', taxable: true, includedInGross: true },
      { key: 'bonus', label: 'Bonus', taxable: true, includedInGross: true },
      { key: 'overtime', label: 'Overtime', taxable: true, includedInGross: true },
      { key: 'taxableReimbursements', label: 'Taxable reimbursements', taxable: true, includedInGross: true },
      { key: 'nonTaxableReimbursements', label: 'Non-taxable reimbursements', taxable: false, includedInGross: true }
    ],
    statutoryDeductions: {
      eobi: false,
      socialSecurity: false,
      providentFund: false
    },
    salaryTaxSlabs: [
      { min: 0, max: 600000, baseTax: 0, rate: 0 },
      { min: 600000.01, max: 1200000, baseTax: 0, rate: 0.01, baseThreshold: 600000 },
      { min: 1200000.01, max: 2200000, baseTax: 6000, rate: 0.11, baseThreshold: 1200000 },
      { min: 2200000.01, max: 3200000, baseTax: 116000, rate: 0.23, baseThreshold: 2200000 },
      { min: 3200000.01, max: 4100000, baseTax: 346000, rate: 0.30, baseThreshold: 3200000 },
      { min: 4100000.01, max: null, baseTax: 616000, rate: 0.35, baseThreshold: 4100000 }
    ],
    references: [
      {
        label: 'FBR salary tax slab relief for Tax Year 2026',
        source: 'https://www.fbr.gov.pk/salary-rates-for-tax-year-2026-where-salary-is-pk-rs-600000-and-above/174297/174299'
      }
    ],
    assumptions: {
      vendorWithholdingEnabled: false,
      salesTaxEnabled: false
    }
  };
}

export function normalizePkExpenseTax(payload = {}, settings = buildDefaultPkTaxSettings()) {
  const normalizedTreatment = PK_EXPENSE_TAX_TREATMENTS.includes(String(payload.taxTreatment || '').toUpperCase())
    ? String(payload.taxTreatment || '').toUpperCase()
    : String(settings?.deductibilityDefaults?.defaultExpenseTreatment || 'DEDUCTIBLE').toUpperCase();
  let deductiblePercent = Number(payload.deductiblePercent);
  if (!Number.isFinite(deductiblePercent)) {
    deductiblePercent = normalizedTreatment === 'NON_DEDUCTIBLE'
      ? 0
      : normalizedTreatment === 'PARTIALLY_DEDUCTIBLE'
        ? 50
        : 100;
  }
  deductiblePercent = Math.min(Math.max(deductiblePercent, 0), 100);
  return {
    taxTreatment: normalizedTreatment,
    deductiblePercent: asMoney(deductiblePercent),
    nonDeductibleAmount: asMoney(Number(payload.amount || 0) * ((100 - deductiblePercent) / 100)),
    taxNote: payload.taxNote ? String(payload.taxNote) : ''
  };
}

export function annualSalaryTax(annualTaxableIncome, settings = buildDefaultPkTaxSettings()) {
  const income = Math.max(Number(annualTaxableIncome || 0), 0);
  const slabs = Array.isArray(settings?.salaryTaxSlabs) && settings.salaryTaxSlabs.length
    ? settings.salaryTaxSlabs
    : buildDefaultPkTaxSettings().salaryTaxSlabs;
  const slab = slabs.find((row) => income >= Number(row.min || 0) && (row.max == null || income <= Number(row.max)) ) || slabs[slabs.length - 1];
  const threshold = Number(slab.baseThreshold != null ? slab.baseThreshold : slab.min || 0);
  return asMoney(Number(slab.baseTax || 0) + Math.max(income - threshold, 0) * Number(slab.rate || 0));
}

export function calculatePkPayrollItem(item = {}, settings = buildDefaultPkTaxSettings()) {
  const components = {
    basicPay: asMoney(item.basicPay || 0),
    allowances: asMoney(item.allowances || 0),
    bonus: asMoney(item.bonus || 0),
    overtime: asMoney(item.overtime || 0),
    taxableReimbursements: asMoney(item.taxableReimbursements || 0),
    nonTaxableReimbursements: asMoney(item.nonTaxableReimbursements || 0)
  };

  const grossPayProvided = Number(item.grossPay || 0);
  const deductionsProvided = Number(item.deductions || 0);
  const componentGross = asMoney(Object.values(components).reduce((sum, value) => sum + Number(value || 0), 0));
  const taxablePay = asMoney(
    components.basicPay
    + components.allowances
    + components.bonus
    + components.overtime
    + components.taxableReimbursements
    + Number(item.taxableAdjustments || 0)
  );
  const grossPay = componentGross > 0 ? componentGross : asMoney(grossPayProvided || taxablePay);
  const annualizedTaxablePay = asMoney(taxablePay * 12);
  const computedAnnualTax = annualSalaryTax(annualizedTaxablePay, settings);
  const withholdingTax = item.withholdingTax != null
    ? asMoney(item.withholdingTax)
    : asMoney(computedAnnualTax / 12);
  const otherDeductions = item.otherDeductions != null
    ? asMoney(item.otherDeductions)
    : asMoney(Math.max(deductionsProvided - withholdingTax, 0));
  const totalDeductions = asMoney(withholdingTax + otherDeductions);
  const netPay = asMoney(grossPay - totalDeductions);

  return {
    components,
    grossPay,
    taxablePay,
    annualizedTaxablePay,
    annualTax: computedAnnualTax,
    withholdingTax,
    otherDeductions,
    totalDeductions,
    netPay,
    withholdingSection: settings?.withholdingSection || '149',
    taxYearLabel: settings?.taxYearLabel || 'TY2026'
  };
}

export function summarizePkPayrollRun(items = []) {
  return items.reduce((acc, item) => {
    acc.totalGross = asMoney(acc.totalGross + Number(item.grossPay || 0));
    acc.totalTaxablePay = asMoney(acc.totalTaxablePay + Number(item.taxablePay || 0));
    acc.totalWithholdingTax = asMoney(acc.totalWithholdingTax + Number(item.withholdingTax || 0));
    acc.totalOtherDeductions = asMoney(acc.totalOtherDeductions + Number(item.otherDeductions || 0));
    acc.totalDeductions = asMoney(acc.totalDeductions + Number(item.totalDeductions || 0));
    acc.totalNet = asMoney(acc.totalNet + Number(item.netPay || 0));
    return acc;
  }, {
    totalGross: 0,
    totalTaxablePay: 0,
    totalWithholdingTax: 0,
    totalOtherDeductions: 0,
    totalDeductions: 0,
    totalNet: 0
  });
}

export function buildPkTaxReport(db, { fromDate = null, toDate = null, entity = 'PK' } = {}) {
  const targetEntity = normalizeEntity(entity) || 'PK';
  const inRange = (dateValue) => (!fromDate || String(dateValue || '') >= String(fromDate)) && (!toDate || String(dateValue || '') <= String(toDate));

  const expenses = (db.expenses || [])
    .filter((row) => normalizeEntity(row.entity) === targetEntity)
    .filter((row) => inRange(row.date));

  const payrollRuns = (db.payrollRuns || [])
    .filter((run) => inRange(`${run.year}-${String(run.month).padStart(2, '0')}-01`));
  const payrollItems = (db.payrollItems || []).filter((item) => normalizeEntity(item.entity) === targetEntity);

  const payrollByMonth = new Map();
  for (const run of payrollRuns) {
    const monthKey = `${run.year}-${String(run.month).padStart(2, '0')}`;
    const items = payrollItems.filter((item) => item.runId === run.id);
    const gross = asMoney(items.reduce((sum, item) => sum + Number(item.grossPay || 0), 0));
    const taxable = asMoney(items.reduce((sum, item) => sum + Number(item.taxablePay || 0), 0));
    const withheld = asMoney(items.reduce((sum, item) => sum + Number(item.withholdingTax || 0), 0));
    const other = asMoney(items.reduce((sum, item) => sum + Number(item.otherDeductions || 0), 0));
    payrollByMonth.set(monthKey, {
      month: monthKey,
      grossPay: gross,
      taxablePay: taxable,
      withholdingTax: withheld,
      otherDeductions: other,
      netPay: asMoney(items.reduce((sum, item) => sum + Number(item.netPay || 0), 0)),
      employeeCount: items.length,
      runId: run.id
    });
  }

  const nonDeductibleSchedule = expenses
    .map((expense) => ({
      id: expense.id,
      date: expense.date,
      description: expense.description,
      category: expense.category || 'Operating Expense',
      employeeId: expense.employeeId || null,
      amount: asMoney(expense.amount || 0),
      currency: String(expense.currency || 'PKR').toUpperCase(),
      taxTreatment: String(expense.taxTreatment || 'DEDUCTIBLE').toUpperCase(),
      deductiblePercent: Number(expense.deductiblePercent != null ? expense.deductiblePercent : 100),
      nonDeductibleAmount: asMoney(expense.nonDeductibleAmount != null
        ? expense.nonDeductibleAmount
        : Number(expense.amount || 0) * ((100 - Number(expense.deductiblePercent != null ? expense.deductiblePercent : 100)) / 100)),
      taxNote: expense.taxNote || ''
    }))
    .filter((row) => row.taxTreatment !== 'DEDUCTIBLE' || Number(row.nonDeductibleAmount || 0) > 0)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const summary = {
    payrollGross: asMoney([...payrollByMonth.values()].reduce((sum, row) => sum + Number(row.grossPay || 0), 0)),
    payrollTaxable: asMoney([...payrollByMonth.values()].reduce((sum, row) => sum + Number(row.taxablePay || 0), 0)),
    payrollWithholdingTax: asMoney([...payrollByMonth.values()].reduce((sum, row) => sum + Number(row.withholdingTax || 0), 0)),
    payrollNet: asMoney([...payrollByMonth.values()].reduce((sum, row) => sum + Number(row.netPay || 0), 0)),
    nonDeductibleExpense: asMoney(nonDeductibleSchedule.reduce((sum, row) => sum + Number(row.nonDeductibleAmount || 0), 0))
  };

  return {
    entity: targetEntity,
    reportingCurrency: String(db.settings?.reportingCurrency || 'USD').toUpperCase(),
    settings: db.settings?.pkTax || buildDefaultPkTaxSettings(),
    filters: { fromDate, toDate, entity: targetEntity },
    summary,
    payrollByMonth: [...payrollByMonth.values()].sort((a, b) => String(a.month || '').localeCompare(String(b.month || ''))),
    nonDeductibleSchedule
  };
}
