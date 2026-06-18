import { useCallback, useEffect, useState } from "react";
import { fetchLabResults, fetchPricing, savePricing } from "./api";
import type { LabResult, PricingTable } from "./types";

// Stack Lab data: persisted per-stack benchmark results + the editable price table. The run itself is
// driven through useRunStatus (start_lab), so this hook only reads results and edits pricing.
export function useLab() {
  const [results, setResults] = useState<LabResult[]>([]);
  const [pricing, setPricing] = useState<PricingTable>({});
  const [error, setError] = useState<string | null>(null);

  const refreshResults = useCallback(
    () => fetchLabResults().then(setResults).catch((e) => setError(String(e))),
    [],
  );
  const refreshPricing = useCallback(
    () => fetchPricing().then(setPricing).catch((e) => setError(String(e))),
    [],
  );

  useEffect(() => {
    refreshResults();
    refreshPricing();
  }, [refreshResults, refreshPricing]);

  const updatePrice = useCallback(
    (model: string, input: number, output: number) =>
      savePricing(model, input, output)
        .then(setPricing)
        .catch((e) => setError(String(e))),
    [],
  );

  return { results, pricing, error, refreshResults, refreshPricing, updatePrice };
}
