import { useCallback, useEffect, useState } from "react";

// Minimal client-side router (no dependency): two routes, "/" (landing) and "/app" (studio), plus query
// parsing for deep links like /app?view=race&mode=replay&run=demo-golden. Uses history.pushState +
// popstate so the back button and reloads work (Vercel rewrites every path to index.html). Deployed at
// the domain root, so pathnames are compared directly.
export interface Route {
  path: string;
  query: URLSearchParams;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}

function current(): { path: string; search: string } {
  if (typeof window === "undefined") return { path: "/", search: "" };
  return { path: window.location.pathname, search: window.location.search };
}

export function useRoute(): Route {
  const [loc, setLoc] = useState(current);

  useEffect(() => {
    const onPop = () => setLoc(current());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    const url = new URL(to, window.location.origin);
    if (opts?.replace) window.history.replaceState({}, "", url);
    else window.history.pushState({}, "", url);
    setLoc({ path: url.pathname, search: url.search });
    // Landing scrolls; the app does not. Reset scroll on a route change so we never land mid-page.
    window.scrollTo(0, 0);
  }, []);

  return { path: loc.path, query: new URLSearchParams(loc.search), navigate };
}

// Normalised path with any trailing slashes removed ("/app/" -> "/app", "/" -> "/").
export function routeName(path: string): string {
  const p = path.replace(/\/+$/, "");
  return p === "" ? "/" : p;
}
