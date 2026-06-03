"use client";
import { useAuth, useIsSignedIn } from "@/lib/auth";
import useSWR, { type SWRResponse } from "swr";

/** Fetch wrapper that attaches the Clerk session JWT to every request. */
export function useApi() {
  const { getToken } = useAuth();

  async function call<T = unknown>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const token = await getToken();
    const headers = new Headers(init.headers as HeadersInit);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    const res = await fetch(path, { ...init, headers });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw Object.assign(new Error((json as { error?: string }).error || `${res.status}`), { status: res.status, body: json });
    }
    return json as T;
  }

  return call;
}

/**
 * SWR wrapper for authenticated GETs. By default it auto-skips when the
 * user is signed out — the broker would 401 us and pollute logs. Pass
 * `path: null` (standard SWR pattern) to skip for other reasons (e.g.
 * waiting on a prerequisite). Pass `{ allowSignedOut: true }` to force
 * a fetch (e.g. a future public endpoint).
 */
export function useApiSWR<T = unknown>(
  path: string | null,
  opts: { allowSignedOut?: boolean; refreshInterval?: number } = {},
): SWRResponse<T> {
  const call = useApi();
  const signedIn = useIsSignedIn();
  const key = path && (signedIn || opts.allowSignedOut) ? path : null;
  return useSWR<T>(
    key,
    async (p: string) => call<T>(p),
    opts.refreshInterval ? { refreshInterval: opts.refreshInterval } : undefined,
  );
}
