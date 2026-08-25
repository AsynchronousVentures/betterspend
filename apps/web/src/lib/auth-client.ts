import { apiUrl } from './api-url';

const SESSION_COOKIE = 'bs_token';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

export interface SignInResult {
  token?: string;
  user?: { id: string; email: string; name: string };
  error?: string;
  message?: string;
}

export async function parseAuthResponse(res: Response): Promise<SignInResult> {
  const text = await res.text();
  let data: SignInResult = {};
  if (text) {
    try {
      data = JSON.parse(text) as SignInResult;
    } catch {
      data = {};
    }
  }

  if (!res.ok) {
    const status =
      res.status >= 500
        ? `Authentication server error (${res.status})`
        : `Request failed (${res.status})`;
    return { ...data, error: data.message || data.error || status };
  }
  return data;
}

function saveToken(token: string) {
  document.cookie = `${SESSION_COOKIE}=${token}; path=/; max-age=${SESSION_MAX_AGE}; SameSite=Lax`;
}

function clearToken() {
  document.cookie = `${SESSION_COOKIE}=; path=/; max-age=0`;
}

export async function signIn(email: string, password: string): Promise<SignInResult> {
  const res = await fetch(apiUrl('/api/auth/sign-in/email'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    credentials: 'include',
  });
  const data = await parseAuthResponse(res);
  if (data.token) saveToken(data.token);
  return data;
}

export async function signUp(
  email: string,
  password: string,
  name: string,
  organizationName: string,
): Promise<SignInResult> {
  const res = await fetch(apiUrl('/api/v1/bootstrap'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name, organizationName }),
    credentials: 'include',
  });
  const data = await parseAuthResponse(res);
  if (data.error || data.message) return data;
  return signIn(email, password);
}

export async function signOut(): Promise<void> {
  clearToken();
  await fetch(apiUrl('/api/auth/sign-out'), {
    method: 'POST',
    credentials: 'include',
  }).catch(() => {}); // best-effort API sign-out
}

export async function getSession() {
  const res = await fetch(apiUrl('/api/auth/get-session'), {
    credentials: 'include',
  });
  if (!res.ok) return null;
  return res.json();
}
