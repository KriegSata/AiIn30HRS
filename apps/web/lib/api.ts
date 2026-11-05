import type { Session } from '../../../contracts/domain';

export class ApiFailure extends Error {
  constructor(public status: number, message: string, public code = 'REQUEST_FAILED') { super(message); }
}
let token = '';
let identity = '';
let sessionGeneration = 0;
const activeRequests = new Set<AbortController>();
let refreshing: Promise<Session> | null = null;
let authListener: ((session: Session | null) => void) | null = null;
const SIGNED_OUT = 'harvestlink-pending-signout';
function hasPendingSignOut() {
  try { if (localStorage.getItem(SIGNED_OUT) === '1') return true; } catch { /* Cookie marker remains available when local storage is disabled. */ }
  return document.cookie.split(';').some(value => value.trim() === 'hl_signed_out=1');
}
export function beginLocalSignOut() {
  // This non-secret marker survives offline reloads. Startup never rotates the
  // previous HttpOnly refresh token before the queued revocation has succeeded.
  try { localStorage.setItem(SIGNED_OUT, '1'); } catch { /* Cookie fallback below. */ }
  document.cookie = `hl_signed_out=1; Path=/; SameSite=Strict; Max-Age=1209600${location.protocol === 'https:' ? '; Secure' : ''}`;
  setSession(null);
}
export async function revokePendingSignOut() {
  if (!hasPendingSignOut()) return;
  if (!navigator.onLine) throw new ApiFailure(401, 'You are signed out locally. Reconnect to finish securing the previous session.');
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new ApiFailure(response.status, 'Reconnect to finish signing out before signing in again.');
    try { localStorage.removeItem(SIGNED_OUT); } catch { /* Cookie marker is still cleared. */ }
    document.cookie = `hl_signed_out=; Path=/; SameSite=Strict; Max-Age=0${location.protocol === 'https:' ? '; Secure' : ''}`;
  } finally { clearTimeout(timeout); }
}
export function setSession(session: Session | null) {
  const nextIdentity = session ? `${session.user.organizationId}:${session.user.id}` : '';
  if (nextIdentity !== identity) { sessionGeneration++; for (const request of activeRequests) request.abort(); activeRequests.clear(); refreshing = null; }
  identity = nextIdentity; token = session?.accessToken || '';
}
export function onSession(listener: (session: Session | null) => void) { authListener = listener; return () => { authListener = null; }; }
export async function refreshSession(): Promise<Session> {
  await revokePendingSignOut();
  if (refreshing) return refreshing;
  const startedGeneration = sessionGeneration;
  const promise = fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } })
    .then(async response => { const body = await response.json(); if (startedGeneration !== sessionGeneration) throw new ApiFailure(401, 'Account changed. Please review your submission.'); if (!response.ok) throw new ApiFailure(response.status, body.error?.message || 'Please sign in again.'); setSession(body.data); authListener?.(body.data); return body.data; })
    .catch(error => { if (startedGeneration === sessionGeneration) { setSession(null); authListener?.(null); } throw error; })
    .finally(() => { if (refreshing === promise) refreshing = null; });
  refreshing = promise; return promise;
}
export async function api<T>(path: string, options: { method?: string; body?: unknown; key?: string; expectedOwner?: string } = {}, retry = true): Promise<T> {
  if (path === '/auth/login' || path === '/auth/register') await revokePendingSignOut();
  const startedGeneration = sessionGeneration; const startedIdentity = identity;
  if (options.expectedOwner && options.expectedOwner !== identity) throw new ApiFailure(401, 'This submission belongs to another session.');
  const abort = new AbortController(); activeRequests.add(abort); const timer = setTimeout(() => abort.abort(), 18000);
  try {
    const response = await fetch(`/api/v1${path}`, {
      method: options.method || 'GET', credentials: 'same-origin', signal: abort.signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.key ? { 'Idempotency-Key': options.key } : {}) },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}), cache: 'no-store',
    });
    if (startedGeneration !== sessionGeneration) throw new ApiFailure(401, 'Account changed. Please review your submission.');
    if (response.status === 401 && retry && !path.startsWith('/auth/')) { await refreshSession(); if (startedIdentity !== identity || startedGeneration !== sessionGeneration) throw new ApiFailure(401, 'Account changed. Your previous submission will not be retried.'); return api<T>(path, options, false); }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiFailure(response.status, body.error?.message || `Request failed (${response.status}).`, body.error?.code);
    return body.data as T;
  } finally { clearTimeout(timer); activeRequests.delete(abort); }
}
export const accessToken = () => token;
