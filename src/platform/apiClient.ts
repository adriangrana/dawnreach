import { clearAuthToken, getAuthToken, setAuthToken } from './authToken';
import type { AuthResponse, PlatformSession, PlatformUser } from './types';

const DEFAULT_PLATFORM_URL = 'http://127.0.0.1:8790';

export function getPlatformBaseUrl() {
  return String(import.meta.env.VITE_DAWNREACH_PLATFORM_URL || DEFAULT_PLATFORM_URL).replace(/\/$/, '');
}

async function request<T>(path: string, init: RequestInit = {}, authenticated = false): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (authenticated) {
    const token = getAuthToken();
    if (token) headers.set('authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${getPlatformBaseUrl()}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    if (authenticated && response.status === 401) await clearAuthToken();
    throw new Error(String(payload.error || `HTTP ${response.status}`));
  }
  return payload as T;
}

export async function registerPlatformAccount(username: string, password: string) {
  const result = await request<AuthResponse>('/api/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  await setAuthToken(result.token);
  return result.user;
}

export async function loginPlatformAccount(username: string, password: string) {
  const result = await request<AuthResponse>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  await setAuthToken(result.token);
  return result.user;
}

export async function getCurrentPlatformUser() {
  const result = await request<{ user: PlatformUser }>('/api/me', {}, true);
  return result.user;
}

export async function getPlatformSessions() {
  const result = await request<{ sessions: PlatformSession[] }>('/api/auth/sessions', {}, true);
  return result.sessions;
}

export async function logoutPlatformAccount() {
  try {
    if (getAuthToken()) await request<{ ok: true }>('/api/logout', { method: 'POST' }, true);
  } finally {
    await clearAuthToken();
  }
}
