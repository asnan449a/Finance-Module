import { request } from './api.js';
import { state, commit, clearFeedback } from './store.js';
import { navigate } from './router.js';
import { getDefaultPath } from './config/routes.js';

export async function loginWithPassword(email, password) {
  clearFeedback();
  state.session.authenticating = true;
  commit();
  try {
    const session = await request('/api/auth/login', {
      method: 'POST',
      body: { email, password }
    });
    state.session.token = session.token;
    state.session.user = session.user;
    localStorage.setItem('tr_finance_token', state.session.token);
    state.session.authenticating = false;
    commit();
    navigate(getDefaultPath(session.user.role), { replace: true });
    return session.user;
  } catch (error) {
    state.session.authenticating = false;
    commit();
    throw error;
  }
}

export async function loginWithGoogle(idToken) {
  clearFeedback();
  state.session.authenticating = true;
  commit();
  try {
    const session = await request('/api/auth/google', {
      method: 'POST',
      body: { idToken }
    });
    state.session.token = session.token;
    state.session.user = session.user;
    localStorage.setItem('tr_finance_token', state.session.token);
    state.session.authenticating = false;
    commit();
    navigate(getDefaultPath(session.user.role), { replace: true });
    return session.user;
  } catch (error) {
    state.session.authenticating = false;
    commit();
    throw error;
  }
}

export async function hydrateSession() {
  if (!state.session.token) return null;
  try {
    const payload = await request('/api/auth/me');
    state.session.user = payload.user;
    commit();
    return payload.user;
  } catch {
    localStorage.removeItem('tr_finance_token');
    state.session.token = null;
    state.session.user = null;
    commit();
    return null;
  }
}

export function logout() {
  localStorage.removeItem('tr_finance_token');
  state.session.token = null;
  state.session.user = null;
  state.ui.drawer = null;
  state.ui.modal = null;
  commit();
  navigate('/', { replace: true });
}
