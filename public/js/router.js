import { routes, getDefaultPath, getRouteByPath, normalizePath, getAllowedRoutes } from './config/routes.js';
import { state, commit } from './store.js';

let routeListener = null;

export function getCurrentRoute() {
  const fallback = getAllowedRoutes(state.session.user?.role)[0] || routes[0];
  const route = getRouteByPath(state.route.path);
  if (!route) return fallback;
  if (!route.roles.includes(String(state.session.user?.role || '').toUpperCase())) return fallback;
  return route;
}

export function navigate(path, { replace = false } = {}) {
  const nextPath = normalizePath(path);
  state.route.path = nextPath;
  if (replace) window.history.replaceState({}, '', nextPath);
  else window.history.pushState({}, '', nextPath);
  commit();
  if (routeListener) routeListener(nextPath);
}

export function ensureRouteForRole() {
  const role = state.session.user?.role;
  if (!role) return;
  const current = getRouteByPath(state.route.path);
  if (!current || !current.roles.includes(String(role).toUpperCase())) {
    navigate(getDefaultPath(role), { replace: true });
    return;
  }
  state.route.path = normalizePath(window.location.pathname);
}

export function initRouter(onRouteChange) {
  routeListener = onRouteChange;
  window.addEventListener('popstate', () => {
    state.route.path = normalizePath(window.location.pathname);
    commit();
    if (routeListener) routeListener(state.route.path);
  });
}
