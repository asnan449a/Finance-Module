function normalizeEntity(value) {
  const normalized = String(value || '').toUpperCase().trim();
  return ['US', 'UK', 'PK'].includes(normalized) ? normalized : null;
}

function normalizeRole(value) {
  return String(value || '').toUpperCase().trim();
}

export function validateSourceAccountContext(account, {
  entity = null,
  currency = null,
  allowedRoles = [],
  fieldLabel = 'source account'
} = {}) {
  if (!account) return null;

  const expectedEntity = normalizeEntity(entity);
  const expectedCurrency = String(currency || '').toUpperCase().trim() || null;
  const actualEntity = normalizeEntity(account.entity);
  const actualCurrency = String(account.currency || '').toUpperCase().trim() || null;
  const actualRole = normalizeRole(account.accountRole);
  const acceptedRoles = (allowedRoles || []).map(normalizeRole).filter(Boolean);

  if (expectedEntity && actualEntity && expectedEntity !== actualEntity) {
    return `${account.name} cannot be used here because it belongs to ${actualEntity}, not ${expectedEntity}.`;
  }
  if (expectedCurrency && actualCurrency && expectedCurrency !== actualCurrency) {
    return `${account.name} cannot be used here because it is a ${actualCurrency} ${fieldLabel}, not ${expectedCurrency}.`;
  }
  if (acceptedRoles.length && actualRole && !acceptedRoles.includes(actualRole)) {
    return `${account.name} cannot be used here because its role is ${actualRole}, not ${acceptedRoles.join(' / ')}.`;
  }
  return null;
}
