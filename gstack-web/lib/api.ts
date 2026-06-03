"use client";
import { useAuth } from "@/lib/auth";
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

export function useApiSWR<T = unknown>(path: string | null): SWRResponse<T> {
  const call = useApi();
  return useSWR<T>(path, async (p: string) => call<T>(p));
}
