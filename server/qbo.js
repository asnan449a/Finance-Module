import crypto from 'node:crypto';
import { readDb, withDb, appendAudit, nextId, nowIso } from './store.js';
import { periodLockError } from './services/periods.js';

const QBO_CLIENT_ID = process.env.QBO_CLIENT_ID || '';
const QBO_CLIENT_SECRET = process.env.QBO_CLIENT_SECRET || '';
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:4100';
const QBO_REDIRECT_URI = process.env.QBO_REDIRECT_URI || `${APP_BASE_URL}/api/qbo/callback`;
const QBO_SCOPE = process.env.QBO_SCOPE || 'com.intuit.quickbooks.accounting';
const QBO_WEBHOOK_VERIFIER_TOKEN = process.env.QBO_WEBHOOK_VERIFIER_TOKEN || '';
const QBO_ENVIRONMENT = String(process.env.QBO_ENVIRONMENT || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
const QBO_API_BASE = QBO_ENVIRONMENT === 'production'
  ? 'https://quickbooks.api.intuit.com'
  : 'https://sandbox-quickbooks.api.intuit.com';

function getQboConnectReadiness() {
  let redirectHost = null;
  let redirectProtocol = null;
  let redirectValid = false;
  let localRedirect = false;
  let httpsRedirect = false;

  try {
    const parsed = new URL(QBO_REDIRECT_URI);
    redirectHost = parsed.hostname;
    redirectProtocol = parsed.protocol.replace(':', '');
    redirectValid = true;
    localRedirect = ['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname) || parsed.hostname.endsWith('.local');
    httpsRedirect = parsed.protocol === 'https:';
  } catch {
    redirectValid = false;
  }

  const blockers = [];
  if (!QBO_CLIENT_ID || !QBO_CLIENT_SECRET) blockers.push('QuickBooks credentials are missing.');
  if (!redirectValid) blockers.push('Redirect URI is invalid.');
  if (QBO_ENVIRONMENT === 'production') {
    if (!httpsRedirect) blockers.push('Production QuickBooks requires an HTTPS redirect URI.');
    if (localRedirect) blockers.push('Production QuickBooks does not accept localhost or local-network redirect URIs.');
  }

  return {
    configured: Boolean(QBO_CLIENT_ID && QBO_CLIENT_SECRET),
    environment: QBO_ENVIRONMENT,
    redirectValid,
    redirectHost,
    redirectProtocol,
    localRedirect,
    httpsRedirect,
    oauthConnectReady: blockers.length === 0,
    blockers
  };
}

function encodeBasic(value) {
  return Buffer.from(value).toString('base64');
}

function asMoney(value) {
  return Number((Number(value || 0)).toFixed(2));
}

function toDateKey(value) {
  if (!value) return null;
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString().slice(0, 10);
}

function normalizeCurrency(value, fallback = 'USD') {
  return String(value || fallback || 'USD').toUpperCase();
}

function inferEntityFromCurrency(currency, fallback = null) {
  const curr = normalizeCurrency(currency, '');
  if (curr === 'USD') return 'US';
  if (curr === 'GBP') return 'UK';
  if (curr === 'PKR') return 'PK';
  return fallback;
}

function hasReimbursableTag(text) {
  const normalized = String(text || '').toLowerCase();
  return normalized.includes('#biz') || normalized.includes('#reimbursable') || normalized.includes('reimbursable');
}

function mapQboAccountCategory(accountType, postingType, { accountName = '', description = '' } = {}) {
  const type = String(accountType || '').toLowerCase();
  const posting = String(postingType || '').toLowerCase();
  const accountText = String(accountName || '').toLowerCase();
  const descriptionText = String(description || '').toLowerCase();

  if (accountText.includes('chase')) {
    if (hasReimbursableTag(descriptionText)) return 'Operating Expense';
    return 'Partner Draw - Asnan';
  }

  if (descriptionText.includes('upwork') || accountText.includes('upwork')) {
    return posting === 'credit' ? 'Revenue' : 'Upwork Fee';
  }

  if (type.includes('income') || type.includes('revenue')) {
    return posting === 'credit' ? 'Revenue' : 'Revenue Adjustment';
  }
  if (type.includes('expense') || type.includes('cost of goods sold')) {
    return posting === 'debit' ? 'Operating Expense' : 'Expense Reversal';
  }
  if (type.includes('bank') || type.includes('accounts receivable') || type.includes('accounts payable')) {
    return posting === 'credit' ? 'Cash Inflow' : 'Cash Outflow';
  }
  if (type.includes('equity')) return 'Equity Movement';
  if (type.includes('fixed asset') || type.includes('other asset')) return 'Asset Movement';
  return posting === 'credit' ? 'Revenue' : 'Operating Expense';
}

function mapQboAccountRole(accountType, accountSubType = '') {
  const type = String(accountType || '').toLowerCase();
  const subType = String(accountSubType || '').toLowerCase();
  if (type.includes('bank')) return 'BANK';
  if (type.includes('credit card')) return 'CREDIT_CARD';
  if (type.includes('accounts receivable')) return 'AR';
  if (type.includes('accounts payable')) return 'AP';
  if (type.includes('income') || type.includes('revenue')) return 'REVENUE';
  if (type.includes('expense') || type.includes('cost of goods sold')) return 'EXPENSE';
  if (type.includes('equity')) return 'EQUITY';
  if (type.includes('fixed asset')) return 'FIXED_ASSET';
  if (type.includes('other current asset') || type.includes('other asset')) return subType.includes('cash') ? 'WALLET' : 'OTHER_ASSET';
  if (type.includes('other current liability') || type.includes('other liability')) return 'OTHER_LIABILITY';
  return 'OTHER';
}

function inferLineOfService(candidates = []) {
  const text = candidates
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
  if (!text) return null;
  if (text.includes('TRDEV') || text.includes('TR DEV') || text.includes('DEV')) return 'TRDEV';
  if (text.includes('TRBUILD') || text.includes('TR BUILD') || text.includes('BUILD')) return 'TRBUILD';
  if (text.includes('TRFINANCE') || text.includes('TR FINANCE') || text.includes('FINANCE')) return 'TRFINANCE';
  return null;
}

function inferBusinessUnit(candidates = []) {
  const text = candidates
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
  if (!text) return 'SERVICES';
  if (text.includes('PONCHO')) return 'PONCHO';
  if (text.includes('TOWER') || text.includes('ASAR')) return 'TOWER';
  if (text.includes('TREASURY')) return 'TREASURY';
  if (text.includes('CORPORATE')) return 'CORPORATE';
  return 'SERVICES';
}

function inferChannel(candidates = []) {
  const text = candidates
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
  if (!text) return null;
  if (text.includes('UPWORK')) return 'UPWORK';
  return null;
}

function invoiceStatusFromQbo(invoice) {
  const total = Number(invoice.TotalAmt || 0);
  const balance = Number(invoice.Balance || 0);
  if (total > 0 && balance <= 0) return 'PAID';
  if (total > 0 && balance > 0 && balance < total) return 'PARTIAL';
  if (String(invoice.EmailStatus || '').toLowerCase() === 'emailsent') return 'SENT';

  const dueDate = toDateKey(invoice.DueDate);
  if (dueDate && new Date(dueDate).getTime() < Date.now()) return 'OVERDUE';
  return 'APPROVED';
}

function normalizePostingType(value, fallback = 'DEBIT') {
  const normalized = String(value || fallback || 'DEBIT').toUpperCase();
  return normalized === 'CREDIT' ? 'CREDIT' : 'DEBIT';
}

function buildTaggingCandidates(obj = {}, extra = []) {
  const customFieldCandidates = (Array.isArray(obj.CustomField) ? obj.CustomField : [])
    .map((row) => `${row?.Name || ''} ${row?.StringValue || row?.Value || ''}`)
    .filter(Boolean);
  return [
    obj.DocNumber,
    obj.PrivateNote,
    obj.Memo,
    obj.Description,
    obj.CustomerMemo?.value,
    obj.ClassRef?.name,
    obj.DepartmentRef?.name,
    ...customFieldCandidates,
    ...extra
  ].filter(Boolean);
}

function inferFlags({ description = '', accountName = '', category = '' } = {}) {
  const text = `${description || ''} ${accountName || ''} ${category || ''}`.toLowerCase();
  return {
    reimbursable: hasReimbursableTag(text),
    treasuryFlag: text.includes('bank fee') || text.includes('treasury') || text.includes('cash outflow') || text.includes('cash inflow') || text.includes('transfer') || text.includes('fx '),
    intercompanyFlag: text.includes('intercompany') || text.includes('due from') || text.includes('due to') || text.includes('sweep') || text.includes('funding'),
    capexFlag: text.includes('capex') || text.includes('tower') || text.includes('asset movement'),
    partnerTag: text.includes('asnan') ? 'Asnan' : null
  };
}

function resolveAccount(accountByQboId, ref) {
  if (!ref?.value) return null;
  return accountByQboId.get(String(ref.value).trim()) || null;
}

function upsertQboTransactionRow(next, accountByQboId, summary, {
  objectType,
  txnId,
  lineId = 'MAIN',
  date,
  accountRef = null,
  accountName = null,
  accountType = null,
  amount,
  postingType,
  currency,
  description,
  categoryOverride = null,
  lineOfService = null,
  businessUnit = null,
  channel = null,
  entity = null,
  counterparty = null,
  sourceMeta = {}
}) {
  const normalizedAmount = asMoney(amount || 0);
  if (!normalizedAmount || !txnId || !objectType) return false;
  const postingDate = toDateKey(date) || toDateKey(nowIso());
  const lockMessage = periodLockError(next, postingDate);
  if (lockMessage) {
    summary?.errors?.push({
      entity: objectType,
      message: `Skipped ${objectType} ${txnId} line ${lineId} because ${lockMessage}`
    });
    return false;
  }

  const normalizedType = normalizePostingType(postingType, 'DEBIT');
  const acct = accountRef ? resolveAccount(accountByQboId, accountRef) : null;
  const acctName = accountName || acct?.Name || accountRef?.name || 'QBO Ledger';
  const acctType = accountType || acct?.AccountType || '';
  const entityCode = inferEntityFromCurrency(currency, entity || null);
  const sourceSystem = entityCode ? `QBO_${entityCode}` : 'QBO';
  const reference = `QBO-${objectType}-${txnId}-${lineId}`;
  const category = categoryOverride || mapQboAccountCategory(acctType, normalizedType, {
    accountName: acctName,
    description
  });
  const flags = inferFlags({ description, accountName: acctName, category });
  const normalizedLos = lineOfService ? String(lineOfService).toUpperCase() : null;
  const normalizedBu = businessUnit ? String(businessUnit).toUpperCase() : null;
  const normalizedChannel = channel ? String(channel).toUpperCase() : null;
  let tx = next.transactions.find((row) => String(row.reference || '') === reference && String(row.source || '').startsWith('QBO'));

  if (!tx) {
    tx = {
      id: nextId(next, 'TRANSACTION', 'TXN'),
      date: postingDate,
      account: acctName,
      amount: normalizedAmount,
      currency: normalizeCurrency(currency, next.settings?.defaultCurrency || 'USD'),
      type: normalizedType,
      description: description || `${objectType} ${txnId}`,
      category,
      reconciled: false,
      matchedAmount: 0,
      invoiceId: null,
      linkedInvoiceIds: [],
      reimbursable: flags.reimbursable,
      source: sourceSystem,
      reference,
      entity: entityCode,
      channel: normalizedChannel,
      lineOfService: normalizedLos,
      businessUnit: normalizedBu,
      intercompanyFlag: flags.intercompanyFlag,
      treasuryFlag: flags.treasuryFlag,
      capexFlag: flags.capexFlag,
      partnerTag: flags.partnerTag,
      sourceObjectType: objectType,
      sourceObjectId: String(txnId),
      sourceLineId: String(lineId),
      qboAccountId: accountRef?.value ? String(accountRef.value) : (acct?.Id ? String(acct.Id) : null),
      qboAccountType: acctType || null,
      counterparty: counterparty || null,
      sourceMeta,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    next.transactions.push(tx);
    } else {
    tx.date = postingDate || tx.date;
    tx.account = acctName || tx.account;
    tx.amount = normalizedAmount;
    tx.currency = normalizeCurrency(currency, tx.currency || next.settings?.defaultCurrency || 'USD');
    tx.type = normalizedType;
    tx.description = description || tx.description;
    tx.category = category;
    tx.reimbursable = flags.reimbursable;
    tx.source = sourceSystem;
    tx.entity = entityCode;
    tx.channel = normalizedChannel || tx.channel || null;
    tx.lineOfService = normalizedLos || tx.lineOfService || null;
    tx.businessUnit = normalizedBu || tx.businessUnit || null;
    tx.intercompanyFlag = Boolean(flags.intercompanyFlag || tx.intercompanyFlag);
    tx.treasuryFlag = Boolean(flags.treasuryFlag || tx.treasuryFlag);
    tx.capexFlag = Boolean(flags.capexFlag || tx.capexFlag);
    tx.partnerTag = flags.partnerTag || tx.partnerTag || null;
    tx.sourceObjectType = objectType;
    tx.sourceObjectId = String(txnId);
    tx.sourceLineId = String(lineId);
    tx.qboAccountId = accountRef?.value ? String(accountRef.value) : (tx.qboAccountId || null);
    tx.qboAccountType = acctType || tx.qboAccountType || null;
    tx.counterparty = counterparty || tx.counterparty || null;
    tx.sourceMeta = sourceMeta;
    tx.matchedAmount = asMoney(tx.matchedAmount || 0);
    tx.linkedInvoiceIds = Array.isArray(tx.linkedInvoiceIds) ? tx.linkedInvoiceIds : [];
    tx.updatedAt = nowIso();
  }

  if (summary?.transactionObjects?.[objectType]) {
    summary.transactionObjects[objectType].upserted += 1;
  }
  if (summary?.transactions) {
    summary.transactions.upserted += 1;
  }
  return true;
}

function buildSyncChecklist(db, summary) {
  const rows = (db.transactions || []).filter((row) => String(row.source || '').startsWith('QBO'));
  const qboInvoices = (db.invoices || []).filter((row) => row.qboInvoiceId);
  const qboPayments = (db.payments || []).filter((row) => row.source === 'QBO_PULL');

  const statusOf = (pass, warn = false) => (pass ? 'PASS' : warn ? 'WARN' : 'FAIL');
  const items = [];
  const addItem = ({ id, title, pass, warn = false, detail }) => items.push({ id, title, status: statusOf(pass, warn), detail });

  const requiredTxFields = ['date', 'account', 'amount', 'currency', 'type', 'description', 'category', 'source', 'reference', 'entity', 'sourceObjectType'];
  const txMissing = rows.filter((row) => requiredTxFields.some((field) => row[field] === undefined || row[field] === null || row[field] === '')).length;
  addItem({
    id: 'tx_core_fields',
    title: 'QBO transactions contain required core fields',
    pass: txMissing === 0,
    detail: `${rows.length} checked, ${txMissing} missing required fields`
  });

  const revenueRows = rows.filter((row) => String(row.category || '').toLowerCase().includes('revenue'));
  const revenueMissingLos = revenueRows.filter((row) => !row.lineOfService).length;
  addItem({
    id: 'tx_revenue_los',
    title: 'Revenue transactions have line-of-service tags',
    pass: revenueMissingLos === 0,
    warn: revenueRows.length > 0 && revenueMissingLos > 0,
    detail: `${revenueRows.length} revenue rows, ${revenueMissingLos} missing LOS`
  });

  const invoiceMissingCore = qboInvoices.filter((row) => !row.issueDate || row.total === undefined || !row.currency || !row.status || !row.entity).length;
  addItem({
    id: 'invoice_core_fields',
    title: 'QBO invoices contain reporting fields',
    pass: invoiceMissingCore === 0,
    detail: `${qboInvoices.length} checked, ${invoiceMissingCore} missing core fields`
  });

  const invoiceMissingLos = qboInvoices.filter((row) => !row.lineOfService).length;
  addItem({
    id: 'invoice_los_tags',
    title: 'QBO invoices are tagged by line of service',
    pass: invoiceMissingLos === 0,
    warn: qboInvoices.length > 0 && invoiceMissingLos > 0,
    detail: `${qboInvoices.length} invoices, ${invoiceMissingLos} missing LOS`
  });

  const unlinkedPayments = qboPayments.filter((row) => !db.invoices.find((inv) => inv.id === row.invoiceId)).length;
  addItem({
    id: 'payment_links',
    title: 'QBO pulled payments link to invoices',
    pass: unlinkedPayments === 0,
    detail: `${qboPayments.length} payments, ${unlinkedPayments} unlinked`
  });

  const coverageRows = Object.entries(summary?.transactionObjects || {});
  const coverageFailures = coverageRows.filter(([, value]) => value.fetched > 0 && value.upserted === 0).length;
  addItem({
    id: 'object_coverage',
    title: 'Fetched transaction objects are represented in ERP ledger',
    pass: coverageFailures === 0,
    detail: coverageRows.map(([name, value]) => `${name}:${value.upserted}/${value.fetched}`).join(' | ')
  });

  const failCount = items.filter((item) => item.status === 'FAIL').length;
  const warnCount = items.filter((item) => item.status === 'WARN').length;
  return {
    generatedAt: nowIso(),
    pass: failCount === 0,
    failCount,
    warnCount,
    itemCount: items.length,
    items
  };
}

function backfillLegacyQboTransactionFields(db) {
  for (const row of db.transactions || []) {
    if (!String(row.source || '').startsWith('QBO')) continue;
    if (!row.reference) continue;
    const ref = String(row.reference);

    if (!row.entity) {
      row.entity = inferEntityFromCurrency(row.currency, String(db.qbo?.selectedEntity || '').toUpperCase() || null);
    }

    if (!row.sourceObjectType) {
      if (ref.startsWith('QBO-JE-')) row.sourceObjectType = 'JournalEntry';
      else if (ref.startsWith('QBO-PAY-')) row.sourceObjectType = 'CustomerPayment';
      else if (ref.startsWith('QBO-')) {
        const objectType = ref.split('-')[1] || null;
        row.sourceObjectType = objectType || 'Legacy';
      } else {
        row.sourceObjectType = 'Legacy';
      }
    }

    if (!row.sourceObjectId) {
      if (ref.startsWith('QBO-JE-')) {
        const bits = ref.replace('QBO-JE-', '').split('-');
        row.sourceObjectId = bits[0] || null;
        row.sourceLineId = bits.slice(1).join('-') || null;
      } else if (ref.startsWith('QBO-PAY-')) {
        row.sourceObjectId = ref.replace('QBO-PAY-', '') || null;
      }
    }

    if (!row.sourceLineId) row.sourceLineId = 'MAIN';
    row.updatedAt = nowIso();
  }
}

export function quickBooksConfig() {
  return {
    configured: Boolean(QBO_CLIENT_ID && QBO_CLIENT_SECRET),
    clientId: QBO_CLIENT_ID,
    redirectUri: QBO_REDIRECT_URI,
    scope: QBO_SCOPE,
    environment: QBO_ENVIRONMENT
  };
}

export function createConnectUrl({ actorUserId, entityId = null }) {
  if (!QBO_CLIENT_ID || !QBO_CLIENT_SECRET) {
    return { error: 'QBO credentials missing. Set QBO_CLIENT_ID and QBO_CLIENT_SECRET.' };
  }
  const readiness = getQboConnectReadiness();
  if (QBO_ENVIRONMENT === 'production' && !readiness.oauthConnectReady) {
    return {
      error: `QBO production OAuth is not ready. ${readiness.blockers.join(' ')}`
    };
  }
  const state = crypto.randomBytes(18).toString('hex');
  withDb((db) => {
    db.oauthState = db.oauthState || [];
    db.oauthState.push({
      id: state,
      actorUserId,
      entityId,
      expiresAt: Date.now() + 10 * 60 * 1000,
      createdAt: nowIso()
    });
  });

  const url = new URL('https://appcenter.intuit.com/connect/oauth2');
  url.searchParams.set('client_id', QBO_CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', QBO_SCOPE);
  url.searchParams.set('redirect_uri', QBO_REDIRECT_URI);
  url.searchParams.set('state', state);

  return { url: url.toString(), state, redirectUri: QBO_REDIRECT_URI };
}

async function exchangeCode({ code }) {
  const response = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${encodeBasic(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`)}`
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: QBO_REDIRECT_URI
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || `QBO token exchange failed (${response.status})`);
  }
  return payload;
}

async function refreshToken(refreshToken) {
  const response = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${encodeBasic(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`)}`
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || `QBO token refresh failed (${response.status})`);
  }
  return payload;
}

export async function handleCallback({ code, state, realmId }) {
  const db = readDb();
  const stateEntry = (db.oauthState || []).find((entry) => entry.id === String(state));
  if (!stateEntry || stateEntry.expiresAt < Date.now()) {
    throw new Error('OAuth state is invalid or expired.');
  }

  const tokenPayload = await exchangeCode({ code: String(code) });

  withDb((next) => {
    next.oauthState = (next.oauthState || []).filter((entry) => entry.id !== String(state));
    next.qbo.connected = true;
    next.qbo.realmId = realmId ? String(realmId) : next.qbo.realmId || null;
    next.qbo.selectedEntity = stateEntry.entityId || next.qbo.selectedEntity || null;
    next.qbo.accessToken = tokenPayload.access_token;
    next.qbo.refreshToken = tokenPayload.refresh_token;
    next.qbo.expiresAt = Date.now() + (Number(tokenPayload.expires_in || 0) * 1000);
    next.qbo.refreshExpiresAt = Date.now() + (Number(tokenPayload.x_refresh_token_expires_in || 0) * 1000);
    next.qbo.lastSyncAt = nowIso();
    next.qbo.lastPullError = null;
    appendAudit(next, {
      actorUserId: stateEntry.actorUserId,
      module: 'qbo',
      action: 'oauth_connected',
      entityType: 'integration',
      entityId: 'quickbooks',
      details: JSON.stringify({ realmId: next.qbo.realmId, selectedEntity: next.qbo.selectedEntity, environment: QBO_ENVIRONMENT })
    });
  });

  return { ok: true };
}

async function ensureAccessToken(db) {
  if (!db.qbo.connected) throw new Error('QuickBooks is not connected.');
  if (!db.qbo.refreshToken) throw new Error('QuickBooks refresh token is missing.');
  if (db.qbo.accessToken && Number(db.qbo.expiresAt || 0) > Date.now() + 30 * 1000) {
    return db.qbo.accessToken;
  }
  const refreshed = await refreshToken(db.qbo.refreshToken);
  withDb((next) => {
    next.qbo.accessToken = refreshed.access_token;
    next.qbo.refreshToken = refreshed.refresh_token || next.qbo.refreshToken;
    next.qbo.expiresAt = Date.now() + (Number(refreshed.expires_in || 0) * 1000);
    next.qbo.refreshExpiresAt = Date.now() + (Number(refreshed.x_refresh_token_expires_in || 0) * 1000);
    next.qbo.lastSyncAt = nowIso();
  });
  return refreshed.access_token;
}

async function qboRequest({ realmId, accessToken, method = 'GET', endpoint, body = null, contentType = 'application/json' }) {
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`
  };
  if (contentType) headers['Content-Type'] = contentType;

  const requestBody = body == null
    ? undefined
    : contentType === 'application/json'
      ? JSON.stringify(body)
      : String(body);

  const response = await fetch(`${QBO_API_BASE}/v3/company/${encodeURIComponent(realmId)}${endpoint}`, {
    method,
    headers,
    body: requestBody
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload?.Fault?.Error?.[0]?.Detail || payload?.fault?.error?.[0]?.message || `QBO request failed (${response.status})`);
  }
  return payload;
}

async function qboQuery({ realmId, accessToken, query }) {
  return qboRequest({
    realmId,
    accessToken,
    method: 'POST',
    endpoint: '/query?minorversion=70',
    body: query,
    contentType: 'application/text'
  });
}

async function qboQueryAll({ realmId, accessToken, entity, queryWhere = '' }) {
  const rows = [];
  const pageSize = 1000;
  let startPosition = 1;

  while (true) {
    const query = `select * from ${entity}${queryWhere ? ` where ${queryWhere}` : ''} startposition ${startPosition} maxresults ${pageSize}`;
    const response = await qboQuery({ realmId, accessToken, query });
    const batch = response?.QueryResponse?.[entity] || [];
    const normalized = Array.isArray(batch) ? batch : batch ? [batch] : [];
    rows.push(...normalized);

    if (normalized.length < pageSize) break;
    startPosition += pageSize;
    if (startPosition > 100000) break;
  }

  return rows;
}

function qboTxnDateWhere({ fromDate = null, toDate = null } = {}) {
  const clauses = [];
  if (toDateKey(fromDate)) clauses.push(`TxnDate >= '${toDateKey(fromDate)}'`);
  if (toDateKey(toDate)) clauses.push(`TxnDate <= '${toDateKey(toDate)}'`);
  return clauses.join(' and ');
}

export async function pullFullQboData(
  actorUserId = null,
  {
    includeCustomers = true,
    includeInvoices = true,
    includePayments = true,
    includeAccounts = true,
    includeTransactions = true,
    fromDate = null,
    toDate = null
  } = {}
) {
  const db = readDb();
  if (!db.qbo.connected || !db.qbo.realmId) {
    return { ok: false, error: 'QuickBooks not connected.' };
  }

  const accessToken = await ensureAccessToken(db);
  const realmId = db.qbo.realmId;
  const errors = [];
  const txnWhere = qboTxnDateWhere({ fromDate, toDate });

  const safelyPull = async (label, fn) => {
    try {
      return await fn();
    } catch (error) {
      errors.push({
        entity: label,
        message: error instanceof Error ? error.message : `Failed to pull ${label}`
      });
      return [];
    }
  };

  const customers = includeCustomers ? await safelyPull('Customer', () => qboQueryAll({ realmId, accessToken, entity: 'Customer' })) : [];
  const accounts = includeAccounts ? await safelyPull('Account', () => qboQueryAll({ realmId, accessToken, entity: 'Account' })) : [];
  const invoices = includeInvoices ? await safelyPull('Invoice', () => qboQueryAll({ realmId, accessToken, entity: 'Invoice', queryWhere: txnWhere })) : [];
  const payments = includePayments ? await safelyPull('Payment', () => qboQueryAll({ realmId, accessToken, entity: 'Payment', queryWhere: txnWhere })) : [];
  const journalEntries = includeTransactions ? await safelyPull('JournalEntry', () => qboQueryAll({ realmId, accessToken, entity: 'JournalEntry', queryWhere: txnWhere })) : [];
  const purchases = includeTransactions ? await safelyPull('Purchase', () => qboQueryAll({ realmId, accessToken, entity: 'Purchase', queryWhere: txnWhere })) : [];
  const bills = includeTransactions ? await safelyPull('Bill', () => qboQueryAll({ realmId, accessToken, entity: 'Bill', queryWhere: txnWhere })) : [];
  const billPayments = includeTransactions ? await safelyPull('BillPayment', () => qboQueryAll({ realmId, accessToken, entity: 'BillPayment', queryWhere: txnWhere })) : [];
  const deposits = includeTransactions ? await safelyPull('Deposit', () => qboQueryAll({ realmId, accessToken, entity: 'Deposit', queryWhere: txnWhere })) : [];
  const transfers = includeTransactions ? await safelyPull('Transfer', () => qboQueryAll({ realmId, accessToken, entity: 'Transfer', queryWhere: txnWhere })) : [];
  const salesReceipts = includeTransactions ? await safelyPull('SalesReceipt', () => qboQueryAll({ realmId, accessToken, entity: 'SalesReceipt', queryWhere: txnWhere })) : [];
  const vendorCredits = includeTransactions ? await safelyPull('VendorCredit', () => qboQueryAll({ realmId, accessToken, entity: 'VendorCredit', queryWhere: txnWhere })) : [];
  const creditCardPayments = includeTransactions ? await safelyPull('CreditCardPayment', () => qboQueryAll({ realmId, accessToken, entity: 'CreditCardPayment', queryWhere: txnWhere })) : [];

  const accountByQboId = new Map(accounts.map((row) => [String(row.Id), row]));

  const result = withDb((next) => {
    const now = nowIso();
    const summary = {
      pulledAt: now,
      realmId,
      environment: QBO_ENVIRONMENT,
      options: { includeCustomers, includeInvoices, includePayments, includeAccounts, includeTransactions, fromDate: toDateKey(fromDate), toDate: toDateKey(toDate) },
      customers: { fetched: customers.length, upserted: 0 },
      accounts: { fetched: accounts.length, upserted: 0 },
      invoices: { fetched: invoices.length, upserted: 0 },
      payments: { fetched: payments.length, upserted: 0 },
      transactions: {
        fetched: journalEntries.length
          + purchases.length
          + bills.length
          + billPayments.length
          + deposits.length
          + transfers.length
          + salesReceipts.length
          + vendorCredits.length
          + creditCardPayments.length,
        upserted: 0
      },
      transactionObjects: {
        JournalEntry: { fetched: journalEntries.length, upserted: 0 },
        Purchase: { fetched: purchases.length, upserted: 0 },
        Bill: { fetched: bills.length, upserted: 0 },
        BillPayment: { fetched: billPayments.length, upserted: 0 },
        Deposit: { fetched: deposits.length, upserted: 0 },
        Transfer: { fetched: transfers.length, upserted: 0 },
        SalesReceipt: { fetched: salesReceipts.length, upserted: 0 },
        VendorCredit: { fetched: vendorCredits.length, upserted: 0 },
        CreditCardPayment: { fetched: creditCardPayments.length, upserted: 0 },
        CustomerPayment: { fetched: payments.length, upserted: 0 }
      },
      errors
    };

    for (const customer of customers) {
      const qboCustomerId = String(customer.Id || '').trim();
      if (!qboCustomerId) continue;
      let client = next.clients.find((row) => String(row.qboCustomerId || '') === qboCustomerId);
      if (!client) {
        client = next.clients.find((row) => String(row.name || '').toLowerCase() === String(customer.DisplayName || '').toLowerCase());
      }
      if (!client) {
        client = {
          id: nextId(next, 'CLIENT', 'CLI'),
          name: customer.DisplayName || customer.CompanyName || `QBO Customer ${qboCustomerId}`,
          email: customer.PrimaryEmailAddr?.Address || null,
          currency: normalizeCurrency(customer.CurrencyRef?.value, next.settings?.defaultCurrency || 'USD'),
          qboCustomerId,
          status: customer.Active === false ? 'INACTIVE' : 'ACTIVE',
          createdAt: now,
          updatedAt: now
        };
        next.clients.push(client);
      } else {
        client.name = customer.DisplayName || client.name;
        client.email = customer.PrimaryEmailAddr?.Address || client.email;
        client.currency = normalizeCurrency(customer.CurrencyRef?.value, client.currency || next.settings?.defaultCurrency || 'USD');
        client.qboCustomerId = qboCustomerId;
        client.status = customer.Active === false ? 'INACTIVE' : 'ACTIVE';
        client.updatedAt = now;
      }
      summary.customers.upserted += 1;
    }

    for (const account of accounts) {
      const qboAccountId = String(account.Id || '').trim();
      if (!qboAccountId) continue;
      let row = next.accounts.find((item) => String(item.qboAccountId || '') === qboAccountId);
      if (!row) {
        row = next.accounts.find((item) => item.provider === 'QBO' && String(item.name || '').toLowerCase() === String(account.Name || '').toLowerCase());
      }
      const currency = normalizeCurrency(account.CurrencyRef?.value, next.settings?.defaultCurrency || 'USD');
      const entity = String(next.qbo.selectedEntity || '').toUpperCase() || inferEntityFromCurrency(currency, null);
      const accountRole = mapQboAccountRole(account.AccountType, account.AccountSubType);
      const isCashAccount = ['BANK', 'CREDIT_CARD', 'WALLET'].includes(accountRole);
      if (!row) {
        row = {
          id: nextId(next, 'ACCOUNT', 'ACC'),
          name: account.Name || `QBO Account ${qboAccountId}`,
          provider: 'QBO',
          sourceSystem: 'QBO',
          sourceLedger: `QBO_${entity || 'SOURCE'}`,
          entity: entity || null,
          currency,
          status: account.Active === false ? 'INACTIVE' : 'ACTIVE',
          qboAccountId,
          accountType: account.AccountType || null,
          accountSubType: account.AccountSubType || null,
          accountRole,
          isCashAccount,
          showInBankingHub: isCashAccount,
          externalCode: account.FullyQualifiedName || null,
          externalName: account.Name || null,
          notes: account.Description || '',
          currentBalance: asMoney(account.CurrentBalance || 0),
          lastPulledAt: now,
          createdAt: now,
          updatedAt: now
        };
        next.accounts.push(row);
      } else {
        row.name = account.Name || row.name;
        row.provider = 'QBO';
        row.sourceSystem = 'QBO';
        row.sourceLedger = `QBO_${entity || row.entity || 'SOURCE'}`;
        row.entity = entity || row.entity || null;
        row.currency = currency;
        row.status = account.Active === false ? 'INACTIVE' : 'ACTIVE';
        row.qboAccountId = qboAccountId;
        row.accountType = account.AccountType || row.accountType || null;
        row.accountSubType = account.AccountSubType || row.accountSubType || null;
        row.accountRole = accountRole;
        row.isCashAccount = Boolean(row.isCashAccount) || isCashAccount;
        row.showInBankingHub = isCashAccount ? true : Boolean(row.showInBankingHub);
        row.externalCode = account.FullyQualifiedName || row.externalCode || null;
        row.externalName = account.Name || row.externalName || row.name;
        row.notes = account.Description || row.notes || '';
        row.currentBalance = asMoney(account.CurrentBalance || row.currentBalance || 0);
        row.lastPulledAt = now;
        row.updatedAt = now;
      }
      summary.accounts.upserted += 1;
    }

    for (const qboInvoice of invoices) {
      const qboInvoiceId = String(qboInvoice.Id || '').trim();
      if (!qboInvoiceId) continue;
      const issueDate = toDateKey(qboInvoice.TxnDate) || toDateKey(qboInvoice.MetaData?.CreateTime) || toDateKey(now);
      const invoiceLock = periodLockError(next, issueDate);
      if (invoiceLock) {
        summary.errors.push({
          entity: 'Invoice',
          message: `Skipped invoice ${qboInvoice.DocNumber || qboInvoiceId} because ${invoiceLock}`
        });
        continue;
      }
      let invoice = next.invoices.find((row) => String(row.qboInvoiceId || '') === qboInvoiceId);
      if (!invoice && qboInvoice.DocNumber) {
        invoice = next.invoices.find((row) => String(row.invoiceNumber || '') === String(qboInvoice.DocNumber));
      }

      const qboCustomerId = String(qboInvoice.CustomerRef?.value || '').trim();
      const client = qboCustomerId ? next.clients.find((row) => String(row.qboCustomerId || '') === qboCustomerId) : null;

      const lineItems = (Array.isArray(qboInvoice.Line) ? qboInvoice.Line : [])
        .filter((line) => Number(line.Amount || 0) > 0 || line.Description)
        .map((line, index) => {
          const detail = line.SalesItemLineDetail || {};
          const qty = Number(detail.Qty || 1);
          const rate = Number(detail.UnitPrice || (qty ? Number(line.Amount || 0) / qty : Number(line.Amount || 0)));
          return {
            description: line.Description || detail.ItemRef?.name || `QBO line ${index + 1}`,
            qty,
            rate: asMoney(rate),
            amount: asMoney(line.Amount || qty * rate),
            timeEntryIds: []
          };
        });
      const customFieldCandidates = (Array.isArray(qboInvoice.CustomField) ? qboInvoice.CustomField : [])
        .map((row) => `${row?.Name || ''} ${row?.StringValue || row?.Value || ''}`)
        .filter(Boolean);
      const taggingCandidates = [
        qboInvoice.DocNumber,
        qboInvoice.PrivateNote,
        qboInvoice.CustomerMemo?.value,
        qboInvoice.ClassRef?.name,
        qboInvoice.DepartmentRef?.name,
        ...customFieldCandidates,
        ...lineItems.map((row) => row.description)
      ];
      const lineOfService = inferLineOfService(taggingCandidates);
      const businessUnit = inferBusinessUnit(taggingCandidates);
      const channel = inferChannel(taggingCandidates);

      const subtotal = asMoney(qboInvoice.TotalAmt || lineItems.reduce((sum, row) => sum + Number(row.amount || 0), 0));
      const taxAmount = asMoney(qboInvoice.TxnTaxDetail?.TotalTax || 0);
      const total = asMoney(qboInvoice.TotalAmt || subtotal + taxAmount);
      const balance = asMoney(qboInvoice.Balance || 0);
      const amountPaid = asMoney(Math.max(total - balance, 0));
      const status = invoiceStatusFromQbo(qboInvoice);

      if (!invoice) {
        invoice = {
          id: nextId(next, 'INVOICE', 'INV'),
          invoiceNumber: qboInvoice.DocNumber || `QBO-${qboInvoiceId}`,
          projectId: null,
          clientId: client?.id || null,
          clientName: client?.name || qboInvoice.CustomerRef?.name || 'QBO Client',
          createdByUserId: null,
          approvedByUserId: null,
          businessUnit,
          lineOfService,
          entity: inferEntityFromCurrency(normalizeCurrency(qboInvoice.CurrencyRef?.value, client?.currency || next.settings?.defaultCurrency || 'USD'), null),
          channel,
          issueDate,
          dueDate: toDateKey(qboInvoice.DueDate),
          currency: normalizeCurrency(qboInvoice.CurrencyRef?.value, client?.currency || next.settings?.defaultCurrency || 'USD'),
          subtotal,
          taxRate: subtotal > 0 ? asMoney(taxAmount / subtotal) : 0,
          taxAmount,
          total,
          amountPaid,
          status,
          approvalStatus: 'APPROVED',
          approvedAt: toDateKey(qboInvoice.MetaData?.LastUpdatedTime) ? `${toDateKey(qboInvoice.MetaData?.LastUpdatedTime)}T00:00:00.000Z` : now,
          sentAt: String(qboInvoice.EmailStatus || '').toLowerCase() === 'emailsent' ? now : null,
          pdfUrl: null,
          lineItems: lineItems.length ? lineItems : [{ description: 'QBO Invoice Amount', qty: 1, rate: total, amount: total, timeEntryIds: [] }],
          qboInvoiceId,
          qboSyncStatus: 'SYNCED',
          qboSyncedAt: now,
          paymentDate: amountPaid > 0 ? toDateKey(qboInvoice.MetaData?.LastUpdatedTime || now) : null,
          notes: qboInvoice.CustomerMemo?.value || '',
          internalNotes: qboInvoice.PrivateNote || '',
          rejectionReason: null,
          createdAt: now,
          updatedAt: now
        };
        next.invoices.push(invoice);
      } else {
        invoice.invoiceNumber = qboInvoice.DocNumber || invoice.invoiceNumber;
        invoice.clientId = client?.id || invoice.clientId || null;
        invoice.clientName = client?.name || qboInvoice.CustomerRef?.name || invoice.clientName;
        invoice.businessUnit = businessUnit || invoice.businessUnit || 'SERVICES';
        invoice.lineOfService = lineOfService || invoice.lineOfService || null;
        invoice.entity = invoice.entity || inferEntityFromCurrency(normalizeCurrency(qboInvoice.CurrencyRef?.value, invoice.currency || client?.currency || next.settings?.defaultCurrency || 'USD'), null);
        invoice.channel = channel || invoice.channel || null;
        invoice.issueDate = issueDate || invoice.issueDate;
        invoice.dueDate = toDateKey(qboInvoice.DueDate) || invoice.dueDate;
        invoice.currency = normalizeCurrency(qboInvoice.CurrencyRef?.value, invoice.currency || client?.currency || next.settings?.defaultCurrency || 'USD');
        invoice.subtotal = subtotal;
        invoice.taxAmount = taxAmount;
        invoice.taxRate = subtotal > 0 ? asMoney(taxAmount / subtotal) : invoice.taxRate || 0;
        invoice.total = total;
        invoice.amountPaid = amountPaid;
        invoice.status = status;
        invoice.approvalStatus = status === 'REJECTED' ? 'REJECTED' : 'APPROVED';
        invoice.lineItems = lineItems.length ? lineItems : invoice.lineItems;
        invoice.qboInvoiceId = qboInvoiceId;
        invoice.qboSyncStatus = 'SYNCED';
        invoice.qboSyncedAt = now;
        invoice.paymentDate = amountPaid > 0 ? toDateKey(qboInvoice.MetaData?.LastUpdatedTime || now) : invoice.paymentDate;
        invoice.notes = qboInvoice.CustomerMemo?.value || invoice.notes || '';
        invoice.internalNotes = qboInvoice.PrivateNote || invoice.internalNotes || '';
        invoice.updatedAt = now;
      }
      summary.invoices.upserted += 1;
    }

    for (const qboPayment of payments) {
      const paymentId = String(qboPayment.Id || '').trim();
      if (!paymentId) continue;
      const lines = Array.isArray(qboPayment.Line) ? qboPayment.Line : [];
      const links = [];

      for (const line of lines) {
        const linked = Array.isArray(line.LinkedTxn) ? line.LinkedTxn : [];
        for (const link of linked) {
          if (!link?.TxnId) continue;
          links.push({
            qboInvoiceId: String(link.TxnId),
            amount: asMoney(link.Amount || line.Amount || qboPayment.TotalAmt || 0)
          });
        }
      }

      for (const link of links) {
        const invoice = next.invoices.find((row) => String(row.qboInvoiceId || '') === String(link.qboInvoiceId));
        if (!invoice) continue;
        const paymentDate = toDateKey(qboPayment.TxnDate) || toDateKey(now);
        const paymentLock = periodLockError(next, paymentDate);
        if (paymentLock) {
          summary.errors.push({
            entity: 'Payment',
            message: `Skipped payment ${paymentId} against ${invoice.invoiceNumber} because ${paymentLock}`
          });
          continue;
        }

        const reference = `QBO-PAY-${paymentId}`;
        let row = next.payments.find((item) => item.reference === reference && item.invoiceId === invoice.id && item.source === 'QBO_PULL');

        if (!row) {
          row = {
            id: nextId(next, 'PAYMENT', 'PAY'),
            invoiceId: invoice.id,
            amount: asMoney(link.amount || qboPayment.TotalAmt || 0),
            currency: normalizeCurrency(qboPayment.CurrencyRef?.value, invoice.currency || next.settings?.defaultCurrency || 'USD'),
            source: 'QBO_PULL',
            reference,
            paidAt: paymentDate,
            status: 'PAID',
            approvalStatus: 'AUTO_APPROVED',
            approvedByUserId: null,
            approvedAt: now,
            postedAt: now,
            meta: {
              qboPaymentId: paymentId,
              qboInvoiceId: link.qboInvoiceId
            },
            createdAt: now,
            updatedAt: now
          };
          next.payments.push(row);
        } else {
          row.amount = asMoney(link.amount || row.amount || 0);
          row.currency = normalizeCurrency(qboPayment.CurrencyRef?.value, row.currency || invoice.currency || next.settings?.defaultCurrency || 'USD');
          row.paidAt = paymentDate || row.paidAt;
          row.status = 'PAID';
          row.approvalStatus = 'AUTO_APPROVED';
          row.approvedAt = row.approvedAt || now;
          row.postedAt = row.postedAt || now;
          row.updatedAt = now;
        }
        summary.payments.upserted += 1;
      }

      const linkedInvoices = links
        .map((link) => next.invoices.find((row) => String(row.qboInvoiceId || '') === String(link.qboInvoiceId)))
        .filter(Boolean);
      const losSet = new Set(linkedInvoices.map((row) => row.lineOfService).filter(Boolean));
      const los = losSet.size === 1 ? [...losSet][0] : null;
      const description = qboPayment.PrivateNote || qboPayment.PaymentRefNum || `QBO Payment ${paymentId}`;
      const txCandidates = buildTaggingCandidates(qboPayment, [description, linkedInvoices.map((row) => row.clientName).join(' ')]);
      const paymentChannel = inferChannel(txCandidates);
      const paymentBu = inferBusinessUnit(txCandidates);
      const paymentEntityFallback = String(next.qbo.selectedEntity || '').toUpperCase() || null;

      upsertQboTransactionRow(next, accountByQboId, summary, {
        objectType: 'CustomerPayment',
        txnId: paymentId,
        lineId: 'MAIN',
        date: qboPayment.TxnDate || qboPayment.MetaData?.CreateTime || now,
        accountRef: qboPayment.DepositToAccountRef || null,
        accountName: qboPayment.DepositToAccountRef?.name || 'QBO Customer Payment',
        accountType: resolveAccount(accountByQboId, qboPayment.DepositToAccountRef)?.AccountType || 'Bank',
        amount: qboPayment.TotalAmt || links.reduce((sum, row) => sum + Number(row.amount || 0), 0),
        postingType: 'CREDIT',
        currency: normalizeCurrency(qboPayment.CurrencyRef?.value, next.settings?.defaultCurrency || 'USD'),
        description,
        categoryOverride: 'Cash Inflow',
        lineOfService: los,
        businessUnit: paymentBu,
        channel: paymentChannel,
        entity: ['US', 'UK', 'PK'].includes(paymentEntityFallback) ? paymentEntityFallback : null,
        counterparty: linkedInvoices.map((row) => row.clientName).filter(Boolean).join(', ') || qboPayment.CustomerRef?.name || null,
        sourceMeta: {
          qboPaymentId: paymentId,
          linkedInvoiceIds: linkedInvoices.map((row) => row.id)
        }
      });
    }

    for (const journal of journalEntries) {
      const lines = Array.isArray(journal.Line) ? journal.Line : [];
      const candidates = buildTaggingCandidates(journal, lines.map((line) => line.Description).filter(Boolean));
      const los = inferLineOfService(candidates);
      const bu = inferBusinessUnit(candidates);
      const channel = inferChannel(candidates);
      const entityFallback = String(next.qbo.selectedEntity || '').toUpperCase() || null;

      for (let idx = 0; idx < lines.length; idx += 1) {
        const line = lines[idx];
        const detail = line.JournalEntryLineDetail || {};
        const amount = asMoney(line.Amount || 0);
        if (amount <= 0) continue;
        upsertQboTransactionRow(next, accountByQboId, summary, {
          objectType: 'JournalEntry',
          txnId: String(journal.Id || 'UNK'),
          lineId: String(line.Id || idx + 1),
          date: journal.TxnDate || journal.MetaData?.CreateTime || now,
          accountRef: detail.AccountRef || null,
          accountName: detail.AccountRef?.name || null,
          amount,
          postingType: detail.PostingType || 'DEBIT',
          currency: normalizeCurrency(journal.CurrencyRef?.value, next.settings?.defaultCurrency || 'USD'),
          description: line.Description || journal.PrivateNote || journal.DocNumber || `QBO Journal ${journal.Id || ''}`,
          lineOfService: los,
          businessUnit: bu,
          channel,
          entity: ['US', 'UK', 'PK'].includes(entityFallback) ? entityFallback : null,
          counterparty: null,
          sourceMeta: {
            docNumber: journal.DocNumber || null,
            classRef: detail.ClassRef || null,
            departmentRef: detail.DepartmentRef || null
          }
        });
      }
    }

    for (const purchase of purchases) {
      const purchaseId = String(purchase.Id || '').trim();
      if (!purchaseId) continue;
      const currency = normalizeCurrency(purchase.CurrencyRef?.value, next.settings?.defaultCurrency || 'USD');
      const lines = Array.isArray(purchase.Line) ? purchase.Line : [];
      const candidates = buildTaggingCandidates(purchase, lines.map((line) => line.Description).filter(Boolean));
      const los = inferLineOfService(candidates);
      const bu = inferBusinessUnit(candidates);
      const channel = inferChannel(candidates);
      const counterparty = purchase.EntityRef?.name || null;

      for (let idx = 0; idx < lines.length; idx += 1) {
        const line = lines[idx];
        const amount = asMoney(line.Amount || 0);
        if (amount <= 0) continue;
        const detail = line.AccountBasedExpenseLineDetail || line.ItemBasedExpenseLineDetail || {};
        upsertQboTransactionRow(next, accountByQboId, summary, {
          objectType: 'Purchase',
          txnId: purchaseId,
          lineId: String(line.Id || idx + 1),
          date: purchase.TxnDate || purchase.MetaData?.CreateTime || now,
          accountRef: detail.AccountRef || null,
          accountName: detail.AccountRef?.name || line.Description || 'Purchase Expense',
          amount,
          postingType: 'DEBIT',
          currency,
          description: line.Description || purchase.PrivateNote || purchase.DocNumber || `QBO Purchase ${purchaseId}`,
          lineOfService: los,
          businessUnit: bu,
          channel,
          entity: inferEntityFromCurrency(currency, null),
          counterparty,
          sourceMeta: {
            paymentType: purchase.PaymentType || null,
            paymentAccountRef: purchase.AccountRef || null
          }
        });
      }

      if (purchase.AccountRef?.value && Number(purchase.TotalAmt || 0) > 0) {
        upsertQboTransactionRow(next, accountByQboId, summary, {
          objectType: 'Purchase',
          txnId: purchaseId,
          lineId: 'PAY',
          date: purchase.TxnDate || purchase.MetaData?.CreateTime || now,
          accountRef: purchase.AccountRef,
          accountName: purchase.AccountRef?.name || 'Purchase Payment Account',
          amount: asMoney(purchase.TotalAmt || 0),
          postingType: 'DEBIT',
          currency,
          description: `Purchase payment ${purchase.DocNumber || purchaseId}`,
          categoryOverride: 'Cash Outflow',
          lineOfService: los,
          businessUnit: bu,
          channel,
          entity: inferEntityFromCurrency(currency, null),
          counterparty,
          sourceMeta: {
            paymentType: purchase.PaymentType || null
          }
        });
      }
    }

    for (const bill of bills) {
      const billId = String(bill.Id || '').trim();
      if (!billId) continue;
      const currency = normalizeCurrency(bill.CurrencyRef?.value, next.settings?.defaultCurrency || 'USD');
      const lines = Array.isArray(bill.Line) ? bill.Line : [];
      const candidates = buildTaggingCandidates(bill, lines.map((line) => line.Description).filter(Boolean));
      const los = inferLineOfService(candidates);
      const bu = inferBusinessUnit(candidates);
      const channel = inferChannel(candidates);
      const counterparty = bill.VendorRef?.name || null;

      for (let idx = 0; idx < lines.length; idx += 1) {
        const line = lines[idx];
        const amount = asMoney(line.Amount || 0);
        if (amount <= 0) continue;
        const detail = line.AccountBasedExpenseLineDetail || line.ItemBasedExpenseLineDetail || {};
        upsertQboTransactionRow(next, accountByQboId, summary, {
          objectType: 'Bill',
          txnId: billId,
          lineId: String(line.Id || idx + 1),
          date: bill.TxnDate || bill.MetaData?.CreateTime || now,
          accountRef: detail.AccountRef || null,
          accountName: detail.AccountRef?.name || line.Description || 'Bill Expense',
          amount,
          postingType: 'DEBIT',
          currency,
          description: line.Description || bill.PrivateNote || bill.DocNumber || `QBO Bill ${billId}`,
          lineOfService: los,
          businessUnit: bu,
          channel,
          entity: inferEntityFromCurrency(currency, null),
          counterparty
        });
      }

      if (bill.APAccountRef?.value && Number(bill.TotalAmt || 0) > 0) {
        upsertQboTransactionRow(next, accountByQboId, summary, {
          objectType: 'Bill',
          txnId: billId,
          lineId: 'AP',
          date: bill.TxnDate || bill.MetaData?.CreateTime || now,
          accountRef: bill.APAccountRef,
          accountName: bill.APAccountRef?.name || 'Accounts Payable',
          amount: asMoney(bill.TotalAmt || 0),
          postingType: 'CREDIT',
          currency,
          description: `Bill accrual ${bill.DocNumber || billId}`,
          categoryOverride: 'Liability Movement',
          lineOfService: los,
          businessUnit: bu,
          channel,
          entity: inferEntityFromCurrency(currency, null),
          counterparty
        });
      }
    }

    for (const billPayment of billPayments) {
      const paymentId = String(billPayment.Id || '').trim();
      if (!paymentId) continue;
      const currency = normalizeCurrency(billPayment.CurrencyRef?.value, next.settings?.defaultCurrency || 'USD');
      const paymentAccountRef = billPayment.CheckPayment?.BankAccountRef || billPayment.CreditCardPayment?.CCAccountRef || null;
      const lines = Array.isArray(billPayment.Line) ? billPayment.Line : [];
      const candidates = buildTaggingCandidates(billPayment, lines.map((line) => line.Description).filter(Boolean));
      const los = inferLineOfService(candidates);
      const channel = inferChannel(candidates);
      const counterparty = billPayment.VendorRef?.name || null;

      upsertQboTransactionRow(next, accountByQboId, summary, {
        objectType: 'BillPayment',
        txnId: paymentId,
        lineId: 'MAIN',
        date: billPayment.TxnDate || billPayment.MetaData?.CreateTime || now,
        accountRef: paymentAccountRef,
        accountName: paymentAccountRef?.name || 'Bill Payment Account',
        amount: asMoney(billPayment.TotalAmt || 0),
        postingType: 'DEBIT',
        currency,
        description: billPayment.PrivateNote || billPayment.DocNumber || `QBO Bill Payment ${paymentId}`,
        categoryOverride: 'Cash Outflow',
        lineOfService: los,
        businessUnit: 'SERVICES',
        channel,
        entity: inferEntityFromCurrency(currency, null),
        counterparty
      });
    }

    for (const deposit of deposits) {
      const depositId = String(deposit.Id || '').trim();
      if (!depositId) continue;
      const currency = normalizeCurrency(deposit.CurrencyRef?.value, next.settings?.defaultCurrency || 'USD');
      const lines = Array.isArray(deposit.Line) ? deposit.Line : [];
      const candidates = buildTaggingCandidates(deposit, lines.map((line) => line.Description).filter(Boolean));
      const channel = inferChannel(candidates);
      const bu = inferBusinessUnit(candidates);

      for (let idx = 0; idx < lines.length; idx += 1) {
        const line = lines[idx];
        const amount = asMoney(line.Amount || 0);
        if (amount <= 0) continue;
        const detail = line.DepositLineDetail || {};
        const linked = Array.isArray(detail.LinkedTxn) ? detail.LinkedTxn : [];
        const linkedInvoice = linked
          .map((row) => next.invoices.find((inv) => String(inv.qboInvoiceId || '') === String(row?.TxnId || '')))
          .find(Boolean);
        const los = linkedInvoice?.lineOfService || inferLineOfService(buildTaggingCandidates(deposit, [line.Description]));
        upsertQboTransactionRow(next, accountByQboId, summary, {
          objectType: 'Deposit',
          txnId: depositId,
          lineId: String(line.Id || idx + 1),
          date: deposit.TxnDate || deposit.MetaData?.CreateTime || now,
          accountRef: deposit.DepositToAccountRef || null,
          accountName: deposit.DepositToAccountRef?.name || 'Deposit Account',
          amount,
          postingType: 'CREDIT',
          currency,
          description: line.Description || deposit.PrivateNote || deposit.DocNumber || `QBO Deposit ${depositId}`,
          categoryOverride: linkedInvoice ? 'Revenue' : 'Cash Inflow',
          lineOfService: los,
          businessUnit: bu,
          channel,
          entity: inferEntityFromCurrency(currency, null),
          counterparty: detail.Entity?.name || null
        });
      }
    }

    for (const transfer of transfers) {
      const transferId = String(transfer.Id || '').trim();
      if (!transferId) continue;
      const amount = asMoney(transfer.Amount || transfer.TotalAmt || 0);
      if (amount <= 0) continue;
      const currency = normalizeCurrency(transfer.CurrencyRef?.value, next.settings?.defaultCurrency || 'USD');
      const description = transfer.PrivateNote || transfer.DocNumber || `QBO Transfer ${transferId}`;
      const candidates = buildTaggingCandidates(transfer, [description]);
      const channel = inferChannel(candidates);

      upsertQboTransactionRow(next, accountByQboId, summary, {
        objectType: 'Transfer',
        txnId: transferId,
        lineId: 'FROM',
        date: transfer.TxnDate || transfer.MetaData?.CreateTime || now,
        accountRef: transfer.FromAccountRef || null,
        accountName: transfer.FromAccountRef?.name || 'Transfer From',
        amount,
        postingType: 'DEBIT',
        currency,
        description: `${description} (from)`,
        categoryOverride: 'Cash Outflow',
        lineOfService: null,
        businessUnit: 'TREASURY',
        channel,
        entity: inferEntityFromCurrency(currency, null),
        counterparty: transfer.ToAccountRef?.name || null,
        sourceMeta: { fromAccountRef: transfer.FromAccountRef || null, toAccountRef: transfer.ToAccountRef || null }
      });

      upsertQboTransactionRow(next, accountByQboId, summary, {
        objectType: 'Transfer',
        txnId: transferId,
        lineId: 'TO',
        date: transfer.TxnDate || transfer.MetaData?.CreateTime || now,
        accountRef: transfer.ToAccountRef || null,
        accountName: transfer.ToAccountRef?.name || 'Transfer To',
        amount,
        postingType: 'CREDIT',
        currency,
        description: `${description} (to)`,
        categoryOverride: 'Cash Inflow',
        lineOfService: null,
        businessUnit: 'TREASURY',
        channel,
        entity: inferEntityFromCurrency(currency, null),
        counterparty: transfer.FromAccountRef?.name || null,
        sourceMeta: { fromAccountRef: transfer.FromAccountRef || null, toAccountRef: transfer.ToAccountRef || null }
      });
    }

    for (const salesReceipt of salesReceipts) {
      const receiptId = String(salesReceipt.Id || '').trim();
      if (!receiptId) continue;
      const currency = normalizeCurrency(salesReceipt.CurrencyRef?.value, next.settings?.defaultCurrency || 'USD');
      const lines = Array.isArray(salesReceipt.Line) ? salesReceipt.Line : [];
      const candidates = buildTaggingCandidates(salesReceipt, lines.map((line) => line.Description).filter(Boolean));
      const bu = inferBusinessUnit(candidates);
      const channel = inferChannel(candidates);
      const counterparty = salesReceipt.CustomerRef?.name || null;

      for (let idx = 0; idx < lines.length; idx += 1) {
        const line = lines[idx];
        const amount = asMoney(line.Amount || 0);
        if (amount <= 0) continue;
        const detail = line.SalesItemLineDetail || {};
        const los = inferLineOfService(buildTaggingCandidates(salesReceipt, [line.Description, detail.ItemRef?.name]));
        upsertQboTransactionRow(next, accountByQboId, summary, {
          objectType: 'SalesReceipt',
          txnId: receiptId,
          lineId: String(line.Id || idx + 1),
          date: salesReceipt.TxnDate || salesReceipt.MetaData?.CreateTime || now,
          accountRef: salesReceipt.DepositToAccountRef || detail.ItemAccountRef || null,
          accountName: salesReceipt.DepositToAccountRef?.name || detail.ItemRef?.name || 'Sales Receipt',
          amount,
          postingType: 'CREDIT',
          currency,
          description: line.Description || salesReceipt.PrivateNote || salesReceipt.DocNumber || `QBO SalesReceipt ${receiptId}`,
          categoryOverride: 'Revenue',
          lineOfService: los,
          businessUnit: bu,
          channel,
          entity: inferEntityFromCurrency(currency, null),
          counterparty
        });
      }
    }

    for (const credit of vendorCredits) {
      const creditId = String(credit.Id || '').trim();
      if (!creditId) continue;
      const currency = normalizeCurrency(credit.CurrencyRef?.value, next.settings?.defaultCurrency || 'USD');
      const lines = Array.isArray(credit.Line) ? credit.Line : [];
      const candidates = buildTaggingCandidates(credit, lines.map((line) => line.Description).filter(Boolean));
      const bu = inferBusinessUnit(candidates);
      const channel = inferChannel(candidates);
      const counterparty = credit.VendorRef?.name || null;

      for (let idx = 0; idx < lines.length; idx += 1) {
        const line = lines[idx];
        const amount = asMoney(line.Amount || 0);
        if (amount <= 0) continue;
        const detail = line.AccountBasedExpenseLineDetail || line.ItemBasedExpenseLineDetail || {};
        const los = inferLineOfService(buildTaggingCandidates(credit, [line.Description]));
        upsertQboTransactionRow(next, accountByQboId, summary, {
          objectType: 'VendorCredit',
          txnId: creditId,
          lineId: String(line.Id || idx + 1),
          date: credit.TxnDate || credit.MetaData?.CreateTime || now,
          accountRef: detail.AccountRef || null,
          accountName: detail.AccountRef?.name || 'Vendor Credit',
          amount,
          postingType: 'CREDIT',
          currency,
          description: line.Description || credit.PrivateNote || credit.DocNumber || `QBO VendorCredit ${creditId}`,
          categoryOverride: 'Expense Reversal',
          lineOfService: los,
          businessUnit: bu,
          channel,
          entity: inferEntityFromCurrency(currency, null),
          counterparty
        });
      }
    }

    for (const ccPayment of creditCardPayments) {
      const paymentId = String(ccPayment.Id || '').trim();
      if (!paymentId) continue;
      const amount = asMoney(ccPayment.Amount || ccPayment.TotalAmt || 0);
      if (amount <= 0) continue;
      const currency = normalizeCurrency(ccPayment.CurrencyRef?.value, next.settings?.defaultCurrency || 'USD');
      const description = ccPayment.PrivateNote || ccPayment.DocNumber || `QBO CreditCardPayment ${paymentId}`;

      upsertQboTransactionRow(next, accountByQboId, summary, {
        objectType: 'CreditCardPayment',
        txnId: paymentId,
        lineId: 'BANK',
        date: ccPayment.TxnDate || ccPayment.MetaData?.CreateTime || now,
        accountRef: ccPayment.BankAccountRef || null,
        accountName: ccPayment.BankAccountRef?.name || 'Bank Account',
        amount,
        postingType: 'DEBIT',
        currency,
        description: `${description} (bank outflow)`,
        categoryOverride: 'Cash Outflow',
        lineOfService: null,
        businessUnit: 'TREASURY',
        channel: null,
        entity: inferEntityFromCurrency(currency, null),
        counterparty: ccPayment.CreditCardAccountRef?.name || null
      });

      upsertQboTransactionRow(next, accountByQboId, summary, {
        objectType: 'CreditCardPayment',
        txnId: paymentId,
        lineId: 'CARD',
        date: ccPayment.TxnDate || ccPayment.MetaData?.CreateTime || now,
        accountRef: ccPayment.CreditCardAccountRef || null,
        accountName: ccPayment.CreditCardAccountRef?.name || 'Credit Card Account',
        amount,
        postingType: 'CREDIT',
        currency,
        description: `${description} (card settlement)`,
        categoryOverride: 'Liability Movement',
        lineOfService: null,
        businessUnit: 'TREASURY',
        channel: null,
        entity: inferEntityFromCurrency(currency, null),
        counterparty: ccPayment.BankAccountRef?.name || null
      });
    }

    backfillLegacyQboTransactionFields(next);
    next.qbo.lastPullAt = now;
    next.qbo.lastPullChecklist = buildSyncChecklist(next, summary);
    next.qbo.lastPullSummary = summary;
    next.qbo.lastPullError = errors.length ? errors.map((row) => `${row.entity}: ${row.message}`).join('; ') : null;
    next.qbo.lastSyncAt = now;

    const logId = nextId(next, 'QBO_LOG', 'QBOLOG');
    next.qbo.syncLogs.push({
      id: logId,
      entityType: 'SYNC',
      entityId: 'FULL_PULL',
      action: 'FULL_PULL',
      direction: 'PULL',
      requestPayload: summary.options,
      responsePayload: {
        customers: summary.customers,
        accounts: summary.accounts,
        invoices: summary.invoices,
        payments: summary.payments,
        transactions: summary.transactions,
        transactionObjects: summary.transactionObjects,
        checklist: next.qbo.lastPullChecklist,
        errors: summary.errors
      },
      status: errors.length ? 'FAILED' : 'SUCCESS',
      errorMessage: errors.length ? next.qbo.lastPullError : null,
      createdAt: now
    });

    appendAudit(next, {
      actorUserId,
      module: 'qbo',
      action: 'full_pull_completed',
      entityType: 'integration',
      entityId: 'quickbooks',
      details: JSON.stringify({
        customers: summary.customers.upserted,
        accounts: summary.accounts.upserted,
        invoices: summary.invoices.upserted,
        payments: summary.payments.upserted,
        transactions: summary.transactions.upserted,
        checklistPass: Boolean(next.qbo.lastPullChecklist?.pass),
        errors: summary.errors.length
      })
    });

    return summary;
  });

  return {
    ok: errors.length === 0,
    partial: errors.length > 0,
    errors,
    summary: result
  };
}

export async function pushInvoiceToQbo(invoice, actorUserId = null) {
  const db = readDb();
  if (!db.qbo.connected || !db.qbo.realmId) {
    withDb((next) => {
      const id = nextId(next, 'QBO_LOG', 'QBOLOG');
      next.qbo.syncLogs.push({
        id,
        entityType: 'INVOICE',
        entityId: invoice.id,
        action: 'CREATE',
        direction: 'PUSH',
        requestPayload: null,
        responsePayload: null,
        status: 'FAILED',
        errorMessage: 'QuickBooks not connected',
        createdAt: nowIso()
      });
      appendAudit(next, {
        actorUserId,
        module: 'qbo',
        action: 'invoice_push_failed',
        entityType: 'invoice',
        entityId: invoice.id,
        details: 'QuickBooks not connected'
      });
    });
    return { ok: false, reason: 'QuickBooks not connected.' };
  }

  const accessToken = await ensureAccessToken(db);
  const realmId = db.qbo.realmId;

  const payload = {
    CustomerRef: { value: '1' },
    DueDate: invoice.dueDate,
    CurrencyRef: { value: invoice.currency },
    Line: (invoice.lineItems || []).map((line, index) => ({
      Id: String(index + 1),
      Amount: Number(line.amount || 0),
      DetailType: 'SalesItemLineDetail',
      Description: line.description,
      SalesItemLineDetail: {
        Qty: Number(line.qty || line.quantity || 0),
        UnitPrice: Number(line.rate || line.unitRate || 0),
        ItemRef: { value: '1', name: 'Services' }
      }
    })),
    DocNumber: invoice.invoiceNumber,
    PrivateNote: invoice.internalNotes || '',
    CustomerMemo: { value: invoice.notes || '' }
  };

  try {
    const response = await qboRequest({
      realmId,
      accessToken,
      method: 'POST',
      endpoint: '/invoice?minorversion=70',
      body: payload
    });
    const qboInvoiceId = response?.Invoice?.Id || `SIM-${invoice.id}`;
    withDb((next) => {
      const current = next.invoices.find((row) => row.id === invoice.id);
      if (current) {
        current.qboInvoiceId = String(qboInvoiceId);
        current.qboSyncStatus = 'SYNCED';
        current.qboSyncedAt = nowIso();
        current.updatedAt = nowIso();
      }
      const id = nextId(next, 'QBO_LOG', 'QBOLOG');
      next.qbo.syncLogs.push({
        id,
        entityType: 'INVOICE',
        entityId: invoice.id,
        qboId: String(qboInvoiceId),
        action: 'CREATE',
        direction: 'PUSH',
        requestPayload: payload,
        responsePayload: response,
        status: 'SUCCESS',
        errorMessage: null,
        createdAt: nowIso()
      });
      appendAudit(next, {
        actorUserId,
        module: 'qbo',
        action: 'invoice_pushed',
        entityType: 'invoice',
        entityId: invoice.id,
        details: JSON.stringify({ qboInvoiceId })
      });
    });
    return { ok: true, qboInvoiceId: String(qboInvoiceId) };
  } catch (error) {
    withDb((next) => {
      const current = next.invoices.find((row) => row.id === invoice.id);
      if (current) {
        current.qboSyncStatus = 'SYNC_FAILED';
        current.updatedAt = nowIso();
      }
      const id = nextId(next, 'QBO_LOG', 'QBOLOG');
      next.qbo.syncLogs.push({
        id,
        entityType: 'INVOICE',
        entityId: invoice.id,
        action: 'CREATE',
        direction: 'PUSH',
        requestPayload: payload,
        responsePayload: null,
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : 'Unknown QBO error',
        createdAt: nowIso()
      });
    });
    return { ok: false, reason: error instanceof Error ? error.message : 'QuickBooks push failed.' };
  }
}

export function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!QBO_WEBHOOK_VERIFIER_TOKEN) return { ok: true, reason: 'Verifier token not configured.' };
  if (!signatureHeader) return { ok: false, reason: 'Missing intuit-signature header.' };
  const expected = crypto
    .createHmac('sha256', QBO_WEBHOOK_VERIFIER_TOKEN)
    .update(rawBody, 'utf8')
    .digest('base64');
  if (expected.length !== String(signatureHeader).length) {
    return { ok: false, reason: 'QuickBooks signature mismatch.' };
  }
  const valid = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signatureHeader)));
  return valid ? { ok: true } : { ok: false, reason: 'QuickBooks signature mismatch.' };
}

export function getQboStatus() {
  const db = readDb();
  return {
    environment: QBO_ENVIRONMENT,
    connected: Boolean(db.qbo.connected),
    realmId: db.qbo.realmId,
    selectedEntity: db.qbo.selectedEntity,
    lastSyncAt: db.qbo.lastSyncAt,
    lastPullAt: db.qbo.lastPullAt || null,
    lastPullSummary: db.qbo.lastPullSummary || null,
    lastPullChecklist: db.qbo.lastPullChecklist || null,
    lastPullError: db.qbo.lastPullError || null,
    hasAccessToken: Boolean(db.qbo.accessToken),
    configured: Boolean(QBO_CLIENT_ID && QBO_CLIENT_SECRET),
    redirectUri: QBO_REDIRECT_URI,
    connectReadiness: getQboConnectReadiness(),
    syncLogs: (db.qbo.syncLogs || []).slice(-100).reverse()
  };
}

export function recordQboPullLog({ entityType = 'PAYMENT', entityId = null, qboId = null, requestPayload = null, responsePayload = null, status = 'SUCCESS', errorMessage = null }) {
  withDb((db) => {
    const id = nextId(db, 'QBO_LOG', 'QBOLOG');
    db.qbo.syncLogs.push({
      id,
      entityType,
      entityId,
      qboId,
      action: 'WEBHOOK_RECEIVED',
      direction: 'PULL',
      requestPayload,
      responsePayload,
      status,
      errorMessage,
      createdAt: nowIso()
    });
  });
}

export async function pollOpenInvoicesAndSync() {
  const db = readDb();
  if (!db.settings?.qboPollingEnabled) {
    return { ok: true, skipped: true, reason: 'Polling disabled in settings.' };
  }
  const result = await pullFullQboData(null, {
    includeCustomers: false,
    includeAccounts: false,
    includeTransactions: false,
    includeInvoices: true,
    includePayments: true
  });

  return {
    ok: result.ok,
    partial: result.partial,
    pulledAt: result.summary?.pulledAt || null,
    invoices: result.summary?.invoices?.upserted || 0,
    payments: result.summary?.payments?.upserted || 0,
    errors: result.errors || []
  };
}
