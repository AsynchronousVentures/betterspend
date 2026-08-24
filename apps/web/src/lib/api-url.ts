const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
const apiBaseUrl = configuredApiBaseUrl?.replace(/\/+$/, '') ?? '';

/**
 * Build a browser-facing API URL. Official images use same-origin requests so
 * one image can run behind any hostname or reverse proxy. Custom builds may
 * set NEXT_PUBLIC_API_URL when the API is intentionally hosted elsewhere.
 */
export function apiUrl(path: `/${string}`): string {
  return `${apiBaseUrl}${path}`;
}

export const apiBaseUrlLabel = apiBaseUrl || 'Same origin';
