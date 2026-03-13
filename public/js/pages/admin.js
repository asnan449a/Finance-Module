import { pageHero } from '../components/layout.js';
import {
  tableCard,
  dataTable,
  workspaceTabs,
  metricGrid,
  badge,
  emptyState,
  workspaceSplit,
  sideStack,
  listCard,
  insightRow,
  callout
} from '../components/primitives.js';
import { sourceAccounts, globalAccounts, accountMappings } from '../selectors.js';
import { money, shortDate, escapeHtml } from '../utils/format.js';

export function renderAdmin(state) {
  const tab = state.ui.activeTabs.admin;
  const qbo = state.data.qboStatus || {};
  const checklist = state.data.qboChecklist || {};
  const accounts = sourceAccounts(state);
  const globals = globalAccounts(state);
  const mappings = accountMappings(state);
  const settings = state.data.financeModel?.settings || state.data.bootstrap?.settings || {};
  const approvalMatrixVersions = state.data.financeModel?.approvalMatrixVersions || [];
  const rules = state.data.bootstrap?.classificationRules || [];
  const audit = state.data.admin.audit || [];
  const notifications = state.data.admin.notifications || [];
  const integrity = state.data.accountingIntegrity || { summary: {}, issues: [] };

  const tabs = workspaceTabs({
    scope: 'admin',
    active: tab,
    items: [
      { value: 'quickbooks', label: 'QuickBooks' },
      { value: 'governance', label: 'Governance' },
      { value: 'finance-model', label: 'Finance model' },
      { value: 'controls', label: 'Controls' }
    ]
  });

  let main = '';
  let side = '';

  if (tab === 'governance') {
    main = `
      <div class="workspace-stack">
        ${tableCard({
          title: 'Source accounts',
          subtitle: 'Governed source accounts and rails shown to operators.',
          toolbar: `<button class="button button--primary" data-action="open-source-account-modal">New source account</button>`,
          table: accounts.length
            ? dataTable({
                columns: [{ label: 'Account' }, { label: 'Entity' }, { label: 'Currency' }, { label: 'Role' }, { label: 'Visible' }, { label: 'Global map' }],
                rows: accounts.map((account) => `
                  <tr data-open-drawer="source-account:${account.id}">
                    <td><strong>${escapeHtml(account.name)}</strong></td>
                    <td>${escapeHtml(account.entity || '—')}</td>
                    <td>${escapeHtml(account.currency || '—')}</td>
                    <td>${escapeHtml(account.accountRole || '—')}</td>
                    <td>${badge(account.showInBankingHub ? 'VISIBLE' : 'HIDDEN', account.showInBankingHub ? 'success' : 'neutral')}</td>
                    <td>${escapeHtml(account.mappedGlobalAccountCode ? `${account.mappedGlobalAccountCode} | ${account.mappedGlobalAccountName}` : 'UNMAPPED')}</td>
                  </tr>
                `),
                empty: 'No source accounts.'
              })
            : emptyState('No source accounts', 'Create governed bank, card, and source-ledger accounts here.')
        })}
        ${tableCard({
          title: 'Source-to-global mappings',
          subtitle: 'Mappings that drive consolidated reporting buckets.',
          toolbar: `<button class="button button--primary" data-action="open-account-mapping-modal">New mapping</button>`,
          table: mappings.length
            ? dataTable({
                columns: [{ label: 'Source account' }, { label: 'Global account' }, { label: 'Overrides' }, { label: 'Status' }],
                rows: mappings.map((mapping) => `
                  <tr data-open-drawer="mapping:${mapping.id}">
                    <td>${escapeHtml(mapping.sourceAccount?.name || mapping.sourceAccountId)}</td>
                    <td>${escapeHtml(mapping.globalAccount ? `${mapping.globalAccount.code} | ${mapping.globalAccount.name}` : mapping.globalAccountId)}</td>
                    <td>${escapeHtml([
                      mapping.entityOverride ? `Entity ${mapping.entityOverride}` : '',
                      mapping.lineOfServiceOverride ? `LOS ${mapping.lineOfServiceOverride}` : '',
                      mapping.businessUnitOverride ? `BU ${mapping.businessUnitOverride}` : ''
                    ].filter(Boolean).join(' · ') || '—')}</td>
                    <td>${badge(mapping.status || 'ACTIVE')}</td>
                  </tr>
                `),
                empty: 'No mappings.'
              })
            : emptyState('No mappings', 'Map source accounts into the global chart to strengthen governance and reporting.')
        })}
      </div>
    `;

    side = sideStack([
      listCard({
        title: 'Governance summary',
        subtitle: 'Coverage and visibility of the finance model.',
        items: [
          insightRow({ title: 'Source accounts', meta: 'Governed rails and ledger accounts', value: `<span>${accounts.length}</span>` }),
          insightRow({ title: 'Global accounts', meta: 'Consolidated chart', value: `<span>${globals.length}</span>` }),
          insightRow({ title: 'Mappings', meta: 'Source-to-global coverage', value: `<span>${mappings.length}</span>` })
        ]
      }),
      tableCard({
        title: 'Global chart',
        subtitle: 'Consolidated reporting accounts.',
        toolbar: `<button class="button button--primary" data-action="open-global-account-modal">New global account</button>`,
        table: globals.length
          ? dataTable({
              columns: [{ label: 'Code' }, { label: 'Name' }, { label: 'Type' }, { label: 'Group' }],
              rows: globals.slice(0, 12).map((account) => `
                <tr data-open-drawer="global-account:${account.id}">
                  <td><strong>${escapeHtml(account.code)}</strong></td>
                  <td>${escapeHtml(account.name)}</td>
                  <td>${escapeHtml(account.type)}</td>
                  <td>${escapeHtml(account.reportingGroup || '—')}</td>
                </tr>
              `),
              empty: 'No global accounts.'
            })
          : emptyState('No global accounts', 'Define the consolidated reporting chart here.')
      })
    ]);
  } else if (tab === 'finance-model') {
    const approvalMatrix = settings.approvalMatrix || state.data.bootstrap?.settings?.approvalMatrix || { rules: [] };
    main = `
      <div class="workspace-stack">
        <section class="panel-card">
          <div class="panel-card__head">
            <div>
              <h3>Finance model settings</h3>
              <p>Reporting currency, entity base currencies, and FX assumptions.</p>
            </div>
            <div class="panel-card__actions"><button class="button button--primary" data-action="save-finance-model">Save finance model</button></div>
          </div>
          <div class="panel-card__body">
            <form class="form-grid form-grid--three" id="finance-model-form">
              <label><span>Reporting currency</span>
                <select id="admin_reporting_currency">
                  ${['USD', 'GBP', 'PKR'].map((currency) => `<option value="${currency}" ${settings.reportingCurrency === currency ? 'selected' : ''}>${currency}</option>`).join('')}
                </select>
              </label>
              ${['US', 'UK', 'PK'].map((entity) => `
                <label><span>${entity} base currency</span>
                  <select id="admin_entity_currency_${entity}">
                    ${['USD', 'GBP', 'PKR'].map((currency) => `<option value="${currency}" ${String(settings.entityBaseCurrencies?.[entity] || '') === currency ? 'selected' : ''}>${currency}</option>`).join('')}
                  </select>
                </label>
              `).join('')}
              ${['USD', 'GBP', 'PKR'].map((currency) => `
                <label><span>${currency} to USD</span><input id="admin_fx_${currency}" type="number" step="0.0001" value="${escapeHtml(String(settings.fxRatesToUSD?.[currency] ?? ''))}" /></label>
              `).join('')}
            </form>
          </div>
        </section>
        ${tableCard({
          title: 'Approval matrix',
          subtitle: 'Current workflow approval rules by document type, amount threshold, entity, and evidence requirement.',
          table: (approvalMatrix.rules || []).length
            ? dataTable({
                columns: [{ label: 'Document' }, { label: 'Entity' }, { label: 'Threshold' }, { label: 'Approvers' }, { label: 'Posters' }, { label: 'Controls' }],
                rows: (approvalMatrix.rules || []).map((rule) => `
                  <tr>
                    <td><strong>${escapeHtml(rule.documentType || '—')}</strong></td>
                    <td>${escapeHtml(rule.entity || '*')}</td>
                    <td>${escapeHtml(`${rule.minAmount || 0} - ${rule.maxAmount == null ? 'No limit' : rule.maxAmount}`)}</td>
                    <td>${escapeHtml((rule.approverRoles || []).join(', ') || '—')}</td>
                    <td>${escapeHtml((rule.posterRoles || []).join(', ') || '—')}</td>
                    <td>${escapeHtml([
                      rule.makerChecker ? 'Maker-checker' : 'Single reviewer',
                      Number(rule.minEvidenceCount || 0) > 0 ? `${rule.minEvidenceCount} evidence required on ${(rule.evidenceRequiredActions || []).join('/') || 'approval'}` : 'No evidence minimum'
                    ].join(' · '))}</td>
                  </tr>
                `),
                empty: 'No approval rules configured.'
              })
            : emptyState('No approval rules', 'Approval policy rules will appear here once configured.')
        })}
      </div>
    `;

    side = sideStack([
      tableCard({
        title: 'Approval policy versions',
        subtitle: 'Active and historical approval matrix versions for audit interpretation.',
        table: approvalMatrixVersions.length
          ? dataTable({
              columns: [{ label: 'Version' }, { label: 'Status' }, { label: 'Effective' }, { label: 'Changed by' }],
              rows: approvalMatrixVersions.map((version) => `
                <tr>
                  <td><strong>v${escapeHtml(String(version.versionNumber || 1))}</strong><br/><span class="muted-copy">${escapeHtml(version.id || '—')}</span></td>
                  <td>${badge(version.isActive ? 'ACTIVE' : (version.status || 'INACTIVE'), version.isActive ? 'success' : 'neutral')}</td>
                  <td>${escapeHtml(shortDate(version.effectiveAt))}</td>
                  <td>${escapeHtml(version.changedByUserId || 'SYSTEM')}</td>
                </tr>
              `),
              empty: 'No approval policy versions.'
            })
          : emptyState('No approval policy history', 'Approval policy versions will appear here when rules are updated.')
      }),
      callout({
        tone: approvalMatrixVersions.length ? 'neutral' : 'warning',
        title: approvalMatrixVersions.length ? `Active policy version v${approvalMatrixVersions.find((version) => version.isActive)?.versionNumber || approvalMatrixVersions[0]?.versionNumber || 1}` : 'No approval policy history yet',
        description: approvalMatrixVersions.length ? 'Historical approvals remain interpretable because policy snapshots and version history are preserved.' : 'Policy versioning history will appear once finance changes approval rules.'
      })
    ]);
  } else if (tab === 'controls') {
    main = `
      <div class="workspace-stack">
        ${tableCard({
          title: 'Top integrity issues',
          subtitle: 'Highest-priority posting and workflow exceptions detected by the accounting engine.',
          table: (integrity.issues || []).length
            ? dataTable({
                columns: [{ label: 'Severity' }, { label: 'Issue' }, { label: 'Workflow' }, { label: 'Journal' }],
                rows: (integrity.issues || []).slice(0, 20).map((row) => `
                  <tr>
                    <td>${badge(row.severity || 'INFO', row.severity === 'CRITICAL' ? 'danger' : 'warning')}</td>
                    <td><strong>${escapeHtml(row.code || 'ISSUE')}</strong><br/><span class="muted-copy">${escapeHtml(row.message || '—')}</span></td>
                    <td>${escapeHtml(`${row.sourceRootType || '—'}:${row.sourceRootId || '—'}`)}</td>
                    <td>${escapeHtml(row.journalId || '—')}</td>
                  </tr>
                `),
                empty: 'No integrity issues.'
              })
            : emptyState('No integrity issues', 'The posting engine is not currently flagging workflow ownership or close-sensitive accounting exceptions.')
        })}
        ${tableCard({
          title: 'Audit trail',
          subtitle: 'Recent finance events across modules.',
          table: audit.length
            ? dataTable({
                columns: [{ label: 'Time' }, { label: 'Module' }, { label: 'Action' }, { label: 'Entity' }, { label: 'Actor' }],
                rows: audit.slice(0, 50).map((event) => `
                  <tr>
                    <td>${escapeHtml(shortDate(event.createdAt))}</td>
                    <td>${escapeHtml(event.module)}</td>
                    <td>${escapeHtml(event.action)}</td>
                    <td>${escapeHtml(`${event.entityType}:${event.entityId || '-'}`)}</td>
                    <td>${escapeHtml(event.actorUserId || 'SYSTEM')}</td>
                  </tr>
                `),
                empty: 'No audit events.'
              })
            : emptyState('No audit events', 'Finance actions will append to the audit log here.')
        })}
      </div>
    `;

    side = sideStack([
      listCard({
        title: 'Controls summary',
        subtitle: 'Current system-control posture.',
        items: [
          insightRow({ title: 'Total issues', meta: 'Accounting integrity', value: `<span>${integrity.summary?.issueCount || 0}</span>`, tone: (integrity.summary?.issueCount || 0) > 0 ? 'warning' : 'success' }),
          insightRow({ title: 'Critical issues', meta: 'Threaten posting trust', value: `<span>${integrity.summary?.criticalCount || 0}</span>`, tone: (integrity.summary?.criticalCount || 0) > 0 ? 'danger' : 'success' }),
          insightRow({ title: 'Warning issues', meta: 'Need finance review', value: `<span>${integrity.summary?.warningCount || 0}</span>` }),
          insightRow({ title: 'Notifications', meta: 'Outbound workflow queue', value: `<span>${notifications.length}</span>` })
        ]
      }),
      tableCard({
        title: 'Notification queue',
        subtitle: 'Outbound workflow notifications.',
        toolbar: `<button class="button button--ghost" data-action="process-notifications">Process queue</button>`,
        table: notifications.length
          ? dataTable({
              columns: [{ label: 'Status' }, { label: 'Recipient' }, { label: 'Subject' }, { label: 'Attempts' }, { label: 'Sent at' }],
              rows: notifications.slice(0, 25).map((item) => `
                <tr>
                  <td>${badge(item.status || 'QUEUED')}</td>
                  <td>${escapeHtml(item.recipient)}</td>
                  <td>${escapeHtml(item.subject)}</td>
                  <td>${item.attempts}</td>
                  <td>${escapeHtml(shortDate(item.sentAt))}</td>
                </tr>
              `),
              empty: 'No notifications.'
            })
          : emptyState('No notifications', 'Workflow notifications will appear here when created.')
      }),
      tableCard({
        title: 'Classification rules',
        subtitle: 'Pattern-based default categorization for imported transactions.',
        table: rules.length
          ? dataTable({
              columns: [{ label: 'Pattern' }, { label: 'Category' }],
              rows: rules.map((rule) => `<tr><td>${escapeHtml(rule.pattern)}</td><td>${escapeHtml(rule.category)}</td></tr>`),
              empty: 'No classification rules.'
            })
          : emptyState('No rules', 'Create classification rules as governance hardens.')
      })
    ]);
  } else {
    main = `
      <div class="workspace-stack">
        ${tableCard({
          title: 'Connection state',
          subtitle: 'QuickBooks OAuth and environment status.',
          toolbar: `
            <div class="toolbar-group">
              <button class="button button--primary" data-action="connect-qbo">Connect QuickBooks</button>
              <button class="button button--ghost" data-action="pull-qbo-full">Run full pull</button>
            </div>
          `,
          table: dataTable({
            columns: [{ label: 'Field' }, { label: 'Value' }],
            rows: [
              `<tr><td>Connected</td><td>${badge(qbo.connected ? 'CONNECTED' : 'NOT CONNECTED', qbo.connected ? 'success' : 'danger')}</td></tr>`,
              `<tr><td>Environment</td><td>${escapeHtml(qbo.environment || '—')}</td></tr>`,
              `<tr><td>Realm ID</td><td>${escapeHtml(qbo.realmId || '—')}</td></tr>`,
              `<tr><td>Redirect URI</td><td>${escapeHtml(qbo.redirectUri || '—')}</td></tr>`,
              `<tr><td>Last full pull</td><td>${escapeHtml(qbo.lastPullAt || qbo.lastSyncAt || '—')}</td></tr>`
            ],
            empty: 'No QuickBooks status.'
          })
        })}
        ${tableCard({
          title: 'Readiness and checklist',
          subtitle: 'Production OAuth blockers and object coverage checks.',
          table: checklist?.checks?.length
            ? dataTable({
                columns: [{ label: 'Check' }, { label: 'Status' }, { label: 'Detail' }],
                rows: checklist.checks.map((row) => `
                  <tr>
                    <td>${escapeHtml(row.label || row.workflow || row.key)}</td>
                    <td>${badge(row.pass ? 'PASS' : 'BLOCKED', row.pass ? 'success' : 'warning')}</td>
                    <td>${escapeHtml(row.detail || row.metric || '—')}</td>
                  </tr>
                `),
                empty: 'No checklist data.'
              })
            : emptyState('No checklist data', 'Run a full pull to refresh source coverage and field completeness.')
        })}
      </div>
    `;

    side = sideStack([
      listCard({
        title: 'Integration summary',
        subtitle: 'Current source-ledger posture.',
        items: [
          insightRow({ title: 'Connected', meta: 'QuickBooks connection state', value: badge(qbo.connected ? 'YES' : 'NO', qbo.connected ? 'success' : 'danger') }),
          insightRow({ title: 'Environment', meta: 'OAuth target', value: `<span>${escapeHtml(qbo.environment || '—')}</span>` }),
          insightRow({ title: 'Last pull', meta: 'Latest data refresh', value: `<span>${escapeHtml(qbo.lastPullAt || qbo.lastSyncAt || '—')}</span>` })
        ]
      }),
      callout({
        tone: qbo.connected ? 'neutral' : 'warning',
        title: qbo.connected ? 'QuickBooks is connected' : 'QuickBooks is not connected',
        description: qbo.connected ? 'Use full-pull and checklist review here; daily finance operations should stay in workspaces, not Admin.' : 'Source sync health and reporting freshness will stay weak until QBO is connected.'
      })
    ]);
  }

  return `
    ${pageHero({
      eyebrow: 'Admin and governance',
      title: 'Admin workspace',
      description: 'Operate source-ledger integration, governance, finance model settings, and control functions from one restricted workspace.',
      actions: `<button class="button button--ghost" data-action="refresh-workspace">Refresh</button>`,
      meta: `<span class="hero-meta-item">${accounts.length} source accounts</span><span class="hero-meta-item">${globals.length} global accounts</span><span class="hero-meta-item">${mappings.length} mappings</span>`
    })}
    ${metricGrid([
      { label: 'Source accounts', value: String(accounts.length), detail: 'Governed source-ledger and cash-rail accounts' },
      { label: 'Global accounts', value: String(globals.length), detail: 'Consolidated reporting chart accounts' },
      { label: 'Mappings', value: String(mappings.length), detail: 'Source-to-global mapping coverage' },
      { label: 'QBO connected', value: qbo.connected ? 'Yes' : 'No', detail: 'Integration state' }
    ])}
    ${tabs}
    ${workspaceSplit({ main, side })}
  `;
}
