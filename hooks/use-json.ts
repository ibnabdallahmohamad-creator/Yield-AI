"use client";

import { useEffect, useState } from "react";

interface Loaded<T> {
  url: string;
  version: string | number;
  data: T | null;
  error: string | null;
}

/**
 * GET a JSON endpoint. `version` re-fetches the same URL (refresh buttons, live updates). While a
 * new response loads, the previous one stays on screen when `keep(previousUrl)` allows it.
 */
export function useJson<T>(url: string, version: string | number = 0, keep: (previousUrl: string) => boolean = () => false) {
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
        if (cancelled) return;
        if (res.status === 401) setLoaded({ url, version, data: null, error: "Your session has ended. Sign in again." });
        else if (!res.ok || !body || (typeof body === "object" && "error" in body && body.error)) {
          setLoaded({ url, version, data: null, error: body?.error ?? "This is unavailable right now." });
        } else setLoaded({ url, version, data: body, error: null });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ url, version, data: null, error: "Couldn't reach the server." });
      });
    return () => {
      cancelled = true;
    };
  }, [url, version]);

  const current = loaded && loaded.url === url && loaded.version === version;
  const usable = loaded && (loaded.url === url || keep(loaded.url));
  return {
    data: usable ? loaded.data : null,
    error: current ? loaded.error : null,
    loading: !current,
  };
}
