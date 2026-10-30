import { useEffect, useState } from "react";
import { useBlocker } from "react-router-dom";

/** Sets the browser tab title */
export function useTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · FocusRealm Mail Merge` : "FocusRealm Mail Merge";
  }, [title]);
}

/** Debounced copy of a value (search boxes) */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Warns before leaving a page (in-app or browser) with unsaved changes */
export function useUnsavedChanges(dirty: boolean) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
  return blocker;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
