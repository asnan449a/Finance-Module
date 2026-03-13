import { getAllowedRoutes, getRouteById } from '../config/routes.js';
import { escapeHtml } from '../utils/format.js';

function groupRoutes(routes = []) {
  const groups = new Map();
  for (const route of routes) {
    const key = route.section || 'Workspace';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(route);
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }));
}

function sidebarItem(route, activePath) {
  return `
    <a class="sidebar-link ${route.path === activePath ? 'is-active' : ''}" href="${route.path}" data-route-link="${route.path}">
      <span>${escapeHtml(route.shortLabel)}</span>
      <small>${escapeHtml(route.label)}</small>
    </a>
  `;
}

function sidebarGroup(group, activePath) {
  return `
    <section class="sidebar-group">
      <span class="sidebar-group__label">${escapeHtml(group.label)}</span>
      <div class="sidebar-group__items">
        ${group.items.map((route) => sidebarItem(route, activePath)).join('')}
      </div>
    </section>
  `;
}

export function loginView(authenticating) {
  return `
    <div class="auth-shell">
      <section class="auth-panel auth-panel--brand">
        <span class="eyebrow">Telerelation Finance</span>
        <h1>Finance operations workspace</h1>
        <p>Focused workspaces for billing, payables, banking, treasury, close, reporting, and governance. This rebuild favors operator clarity and safer finance controls over dashboard noise.</p>
      </section>
      <section class="auth-panel auth-panel--form">
        <div class="auth-panel__head">
          <h2>Sign in</h2>
          <p>Use a demo persona or enter credentials directly.</p>
        </div>
        <div class="persona-list">
          <button class="persona-pill" data-action="persona-login" data-email="accountant@telerelation.local" data-password="account123">Accountant</button>
          <button class="persona-pill" data-action="persona-login" data-email="admin@telerelation.local" data-password="admin123">Admin</button>
          <button class="persona-pill" data-action="persona-login" data-email="partner@telerelation.local" data-password="partner123">Partner</button>
          <button class="persona-pill" data-action="persona-login" data-email="viewer@telerelation.local" data-password="viewer123">Viewer</button>
        </div>
        <form id="login-form" class="form-grid form-grid--single">
          <label>
            <span>Email</span>
            <input id="login_email" type="email" value="accountant@telerelation.local" />
          </label>
          <label>
            <span>Password</span>
            <input id="login_password" type="password" value="account123" />
          </label>
          <button class="button button--primary" type="submit">${authenticating ? 'Signing in...' : 'Sign in'}</button>
        </form>
        <form id="google-form" class="form-grid form-grid--single auth-panel__secondary">
          <label>
            <span>Google ID token</span>
            <input id="google_token" type="text" placeholder="Paste a Google ID token for direct verification" />
          </label>
          <button class="button button--ghost" type="submit">Sign in with Google token</button>
        </form>
      </section>
    </div>
  `;
}

export function appShell({ user, currentRoute, notice, error, content, drawer, modal, workspaceLoading }) {
  const routes = getAllowedRoutes(user?.role);
  const routeMeta = getRouteById(currentRoute.id);
  const groups = groupRoutes(routes);
  return `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="sidebar__brand">
          <span class="eyebrow">Telerelation</span>
          <strong>Finance Operations</strong>
          <p>Internal control, close, reporting, and payment discipline.</p>
        </div>
        <nav class="sidebar__nav">
          ${groups.map((group) => sidebarGroup(group, currentRoute.path)).join('')}
        </nav>
        <div class="sidebar__footer">
          <span class="sidebar__user">${escapeHtml(user?.name || 'Unknown user')}</span>
          <small>${escapeHtml(user?.role || 'UNKNOWN')} · ${escapeHtml(routeMeta.section || 'Workspace')}</small>
        </div>
      </aside>
      <div class="workspace-shell">
        <header class="topbar">
          <div class="topbar__context">
            <span class="eyebrow">${escapeHtml(routeMeta.section || 'Workspace')}</span>
            <strong>${escapeHtml(routeMeta.label)}</strong>
            <p>${escapeHtml(routeMeta.description)}</p>
          </div>
          <div class="topbar__actions">
            <label class="search-field">
              <span>Search this workspace</span>
              <input id="global_search" type="search" placeholder="Search the active register or queue" />
            </label>
            <button class="button button--ghost" data-action="logout">Logout</button>
          </div>
        </header>
        <main class="workspace-main">
          ${notice ? `<div class="banner banner--success">${escapeHtml(notice)}</div>` : ''}
          ${error ? `<div class="banner banner--error">${escapeHtml(error)}</div>` : ''}
          ${workspaceLoading ? '<div class="banner banner--loading">Refreshing workspace data…</div>' : ''}
          ${content}
        </main>
      </div>
      ${drawer || ''}
      ${modal || ''}
    </div>
  `;
}

export function pageHero({ eyebrow, title, description, actions = '', meta = '' }) {
  return `
    <section class="page-hero">
      <div class="page-hero__main">
        <span class="eyebrow">${escapeHtml(eyebrow)}</span>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(description)}</p>
      </div>
      <div class="page-hero__aside">
        ${meta ? `<div class="page-hero__meta">${meta}</div>` : ''}
        ${actions ? `<div class="page-hero__actions">${actions}</div>` : ''}
      </div>
    </section>
  `;
}

export function drawerView(drawer) {
  if (!drawer) return '';
  return `
    <aside class="detail-drawer is-open">
      <div class="detail-drawer__head">
        <div>
          <span class="eyebrow">${escapeHtml(drawer.eyebrow || 'Record')}</span>
          <h3>${escapeHtml(drawer.title || 'Details')}</h3>
          ${drawer.subtitle ? `<p>${escapeHtml(drawer.subtitle)}</p>` : ''}
        </div>
        <button class="icon-button" data-action="close-drawer">✕</button>
      </div>
      <div class="detail-drawer__body">${drawer.body || ''}</div>
      ${drawer.footer ? `<div class="detail-drawer__footer">${drawer.footer}</div>` : ''}
    </aside>
  `;
}

export function modalView(modal) {
  if (!modal) return '';
  return `
    <div class="modal-backdrop">
      <div class="modal-card ${modal.size === 'wide' ? 'modal-card--wide' : ''}">
        <div class="modal-card__head">
          <div>
            <span class="eyebrow">${escapeHtml(modal.eyebrow || 'Action')}</span>
            <h3>${escapeHtml(modal.title || 'Modal')}</h3>
            ${modal.subtitle ? `<p>${escapeHtml(modal.subtitle)}</p>` : ''}
          </div>
          <button class="icon-button" data-action="close-modal">✕</button>
        </div>
        <div class="modal-card__body">${modal.body || ''}</div>
        ${modal.footer ? `<div class="modal-card__footer">${modal.footer}</div>` : ''}
      </div>
    </div>
  `;
}
