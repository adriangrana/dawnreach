import { invoke } from '@tauri-apps/api/core';

const TOKEN_KEY = 'dawnreach.auth.token';
let memoryToken = '';
let bootstrapped = false;

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as unknown as Record<string, unknown>);
}

export async function bootstrapAuthTokenStorage() {
  if (bootstrapped || typeof window === 'undefined') return;
  bootstrapped = true;
  const legacy = window.localStorage.getItem(TOKEN_KEY) || '';

  if (!isTauriRuntime()) {
    memoryToken = legacy;
    return;
  }

  try {
    const nativeToken = String(await invoke<string | null>('auth_token_read') || '');
    memoryToken = nativeToken || legacy;
    if (!nativeToken && legacy) await invoke('auth_token_write', { token: legacy });
  } catch (error) {
    console.warn('[platform-auth] secure token store unavailable; session is memory-only for this run', error);
    memoryToken = legacy;
  } finally {
    // Desktop bearer credentials must not remain in WebView localStorage.
    window.localStorage.removeItem(TOKEN_KEY);
  }
}

export function getAuthToken() {
  if (typeof window === 'undefined') return memoryToken;
  if (isTauriRuntime()) return memoryToken;
  return memoryToken || window.localStorage.getItem(TOKEN_KEY) || '';
}

export async function setAuthToken(token: string) {
  const clean = String(token || '');
  memoryToken = clean;
  if (typeof window === 'undefined') return;
  if (isTauriRuntime()) {
    if (clean) await invoke('auth_token_write', { token: clean });
    else await invoke('auth_token_delete');
    window.localStorage.removeItem(TOKEN_KEY);
    return;
  }
  if (clean) window.localStorage.setItem(TOKEN_KEY, clean);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export async function clearAuthToken() {
  await setAuthToken('');
}
