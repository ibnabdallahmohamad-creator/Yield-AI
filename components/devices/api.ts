/** Browser → /api/farms and /api/devices: JSON in, JSON out, the server's error message on failure. */
export async function callApi<T>(url: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
      headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: init?.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("Can't reach the server. Check your connection and try again.");
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 401) throw new Error("Your session has ended. Sign in again.");
  if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}.`);
  return data;
}

export const errorText = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
