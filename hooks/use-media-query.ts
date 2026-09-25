"use client";

import { useSyncExternalStore } from "react";

/** Whether a CSS media query matches. `serverValue` is used while rendering on the server and hydrating. */
export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** Phones: below Tailwind's `sm` breakpoint. */
export const PHONE_QUERY = "(max-width: 639.98px)";
