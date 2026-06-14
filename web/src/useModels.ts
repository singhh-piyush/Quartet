import { useCallback, useEffect, useState } from "react";
import { fetchModels, saveModels } from "./api";
import type { ModelConfig, ModelSlot } from "./types";

// Loads the per-agent + large model selection and persists edits via POST /api/models.
export function useModels(): {
  models: ModelConfig | null;
  error: string | null;
  saving: boolean;
  update: (target: string, patch: Partial<ModelSlot>) => void;
} {
  const [models, setModels] = useState<ModelConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchModels()
      .then(setModels)
      .catch((e) => setError(String(e)));
  }, []);

  // target is "spec" | "coder" | "tester" | "repairer" | "large".
  const update = useCallback(
    (target: string, patch: Partial<ModelSlot>) => {
      if (!models) return;
      const next: ModelConfig =
        target === "large"
          ? { ...models, large: { ...models.large, ...patch } }
          : { ...models, agents: { ...models.agents, [target]: { ...models.agents[target], ...patch } } };
      setModels(next);
      setSaving(true);
      const body = target === "large" ? { large: patch } : { agents: { [target]: patch } };
      saveModels(body as Partial<ModelConfig>)
        .then((saved) => setModels(saved))
        .catch((e) => setError(String(e)))
        .finally(() => setSaving(false));
    },
    [models],
  );

  return { models, error, saving, update };
}
