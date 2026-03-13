export const routes = [
  {
    id: 'controlTower',
    path: '/control-tower',
    label: 'Control Tower',
    shortLabel: 'Control',
    section: 'Overview',
    description: 'Exceptions, approvals, close blockers, and sync health.',
    roles: ['ADMIN', 'ACCOUNTANT', 'PARTNER', 'VIEWER']
  },
  {
    id: 'approvals',
    path: '/approvals',
    label: 'Approvals Inbox',
    shortLabel: 'Approvals',
    section: 'Review',
    description: 'One finance-wide queue for pending approvals, blocked reviews, and close-sensitive exceptions.',
    roles: ['ADMIN', 'ACCOUNTANT', 'PARTNER']
  },
  {
    id: 'billing',
    path: '/billing',
    label: 'Billing / AR',
    shortLabel: 'Billing',
    section: 'Operations',
    description: 'Invoices, approvals, collections, and customer balances.',
    roles: ['ADMIN', 'ACCOUNTANT', 'PARTNER']
  },
  {
    id: 'payables',
    path: '/payables',
    label: 'Payables / AP',
    shortLabel: 'Payables',
    section: 'Operations',
    description: 'Vendor bills, release controls, payments, and aging.',
    roles: ['ADMIN', 'ACCOUNTANT', 'PARTNER']
  },
  {
    id: 'banking',
    path: '/banking',
    label: 'Banking & Reconciliation',
    shortLabel: 'Banking',
    section: 'Operations',
    description: 'Cash rails, unmatched activity, and matching exceptions.',
    roles: ['ADMIN', 'ACCOUNTANT']
  },
  {
    id: 'treasury',
    path: '/treasury',
    label: 'Treasury & Intercompany',
    shortLabel: 'Treasury',
    section: 'Operations',
    description: 'Cash position, pair exposure, funding, and repayment.',
    roles: ['ADMIN', 'ACCOUNTANT', 'PARTNER']
  },
  {
    id: 'spend',
    path: '/spend',
    label: 'Operating Spend',
    shortLabel: 'Spend',
    section: 'Operations',
    description: 'Operating expenses, employee claims, and reimbursements.',
    roles: ['ADMIN', 'ACCOUNTANT']
  },
  {
    id: 'close',
    path: '/close',
    label: 'Month-End Close',
    shortLabel: 'Close',
    section: 'Close & Reporting',
    description: 'Readiness, signoff, related-party review, and locks.',
    roles: ['ADMIN', 'ACCOUNTANT', 'PARTNER']
  },
  {
    id: 'journals',
    path: '/journals',
    label: 'GL / Journals',
    shortLabel: 'Journals',
    section: 'Close & Reporting',
    description: 'Journal register, trial balance, posting, and integrity.',
    roles: ['ADMIN', 'ACCOUNTANT', 'PARTNER']
  },
  {
    id: 'reports',
    path: '/reports',
    label: 'Reports',
    shortLabel: 'Reports',
    section: 'Close & Reporting',
    description: 'Statements, management views, working capital, and treasury.',
    roles: ['ADMIN', 'ACCOUNTANT', 'PARTNER', 'VIEWER']
  },
  {
    id: 'admin',
    path: '/admin',
    label: 'Admin & Governance',
    shortLabel: 'Admin',
    section: 'Governance',
    description: 'QuickBooks, mappings, approval policy, and controls.',
    roles: ['ADMIN', 'ACCOUNTANT']
  }
];

export function getRouteById(routeId) {
  return routes.find((route) => route.id === routeId) || routes[0];
}

export function getRouteByPath(pathname) {
  const normalized = normalizePath(pathname);
  return routes.find((route) => route.path === normalized) || null;
}

export function normalizePath(pathname) {
  const value = String(pathname || '/').trim();
  if (!value || value === '/') return '/control-tower';
  return value.endsWith('/') && value.length > 1 ? value.slice(0, -1) : value;
}

export function getAllowedRoutes(role) {
  const currentRole = String(role || '').toUpperCase();
  return routes.filter((route) => route.roles.includes(currentRole));
}

export function getDefaultPath(role) {
  return getAllowedRoutes(role)[0]?.path || '/control-tower';
}
