import { clearAuthToken, getAuthToken, setAuthToken } from './authToken';
import type {
  AuthResponse,
  DirectMessage,
  PlatformSession,
  PlatformUser,
  SocialSnapshot,
} from './types';

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

export function getSocialSnapshot() {
  return request<SocialSnapshot>('/api/social/snapshot', {}, true);
}

export async function searchPlatformUsers(query: string) {
  const result = await request<{ users: PlatformUser[] }>(`/api/users/search?q=${encodeURIComponent(query)}`, {}, true);
  return result.users;
}

export async function sendPlatformFriendRequest(userId: string) {
  await request('/api/friends/request', { method: 'POST', body: JSON.stringify({ userId }) }, true);
}

export async function respondPlatformFriendRequest(requestId: string, accept: boolean) {
  await request('/api/friends/respond', { method: 'POST', body: JSON.stringify({ requestId, accept }) }, true);
}

export async function removePlatformFriend(userId: string) {
  await request(`/api/friends?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' }, true);
}

export async function getDirectConversation(userId: string) {
  const result = await request<{ messages: DirectMessage[] }>(`/api/messages?userId=${encodeURIComponent(userId)}`, {}, true);
  return result.messages;
}

export async function sendPlatformDirectMessage(userId: string, text: string) {
  const result = await request<{ message: DirectMessage }>('/api/messages', {
    method: 'POST',
    body: JSON.stringify({ userId, text }),
  }, true);
  return result.message;
}
