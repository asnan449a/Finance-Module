function asMoney(value) {
  return Number((Number(value || 0)).toFixed(2));
}

export function normalizeEntity(entity) {
  const code = String(entity || '').toUpperCase();
  return ['US', 'UK', 'PK'].includes(code) ? code : null;
}

export function normalizeCurrency(currency, fallback = 'USD') {
  const code = String(currency || fallback || 'USD').toUpperCase().trim();
  return code || String(fallback || 'USD').toUpperCase();
}

export function getReportingCurrency(db) {
  return normalizeCurrency(db?.settings?.reportingCurrency || 'USD');
}

export function getEntityBaseCurrency(db, entity) {
  const normalizedEntity = normalizeEntity(entity);
  if (!normalizedEntity) return null;
  return normalizeCurrency(db?.settings?.entityBaseCurrencies?.[normalizedEntity] || null, null);
}

export function inferEntityFromCurrency(db, currency) {
  const curr = normalizeCurrency(currency, '');
  const map = db?.settings?.entityBaseCurrencies || {};
  const match = Object.entries(map).find(([, value]) => normalizeCurrency(value, '') === curr);
  return normalizeEntity(match?.[0] || null);
}

export function fxRatesToUsd(db) {
  const raw = db?.settings?.fxRatesToUSD || {};
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [normalizeCurrency(key), Number(value || 0)]));
}

export function convertAmount(db, amount, fromCurrency, toCurrency = getReportingCurrency(db)) {
  const numeric = asMoney(amount || 0);
  if (!numeric) return 0;
  const from = normalizeCurrency(fromCurrency, getReportingCurrency(db));
  const to = normalizeCurrency(toCurrency, getReportingCurrency(db));
  if (from === to) return numeric;

  const rates = fxRatesToUsd(db);
  const fromToUsd = Number(rates[from] || 0);
  const toToUsd = Number(rates[to] || 0);
  if (!fromToUsd || !toToUsd) return numeric;

  const usdValue = numeric * fromToUsd;
  return asMoney(usdValue / toToUsd);
}

export function toReportingAmount(db, amount, currency) {
  return convertAmount(db, amount, currency, getReportingCurrency(db));
}

export function rateToReporting(db, currency) {
  const from = normalizeCurrency(currency, getReportingCurrency(db));
  const to = getReportingCurrency(db);
  if (from === to) return 1;
  const rates = fxRatesToUsd(db);
  const fromToUsd = Number(rates[from] || 0);
  const toToUsd = Number(rates[to] || 0);
  if (!fromToUsd || !toToUsd) return 1;
  return Number((fromToUsd / toToUsd).toFixed(8));
}

export { asMoney };
