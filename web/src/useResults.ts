import { useEffect, useState } from "react";
import { fetchResults } from "./api";
import type { ConfigResult } from "./types";

// One shared /api/results fetch, reused by the Results and Compare views.
export function useResults(): { configs: ConfigResult[]; error: string | null; loading: boolean } {
  const [configs, setConfigs] = useState<ConfigResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchResults()
      .then((d) => alive && (setConfigs(d.configs), setLoading(false)))
      .catch((e) => alive && (setError(String(e)), setLoading(false)));
    return () => {
      alive = false;
    };
  }, []);

  return { configs, error, loading };
}
