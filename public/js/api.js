import { state } from './store.js';

export async function request(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const finalHeaders = {
    ...(raw ? {} : { 'Content-Type': 'application/json' }),
    ...headers
  };

  if (state.session.token) {
    finalHeaders.Authorization = `Bearer ${state.session.token}`;
  }

  const response = await fetch(path, {
    method,
    headers: finalHeaders,
    body: body == null ? undefined : (raw ? body : JSON.stringify(body))
  });

  if (raw) {
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }
    return response;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}
