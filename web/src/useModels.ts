import { useCallback, useEffect, useState } from "react";
import { fetchModels, saveModels } from "./api";
import type { ModelConfig, ModelSlot } from "./types";

// Merge a partial config over the current one locally (mirrors the server _merge), for optimistic UI.
function applyPatch(base: ModelConfig, patch: Partial<ModelConfig>): ModelConfig {
  const out: ModelConfig = {
    ...base,
    name: patch.name ?? base.name,
    large: { ...base.large, ...(patch.large ?? {}) },
    agents: { ...base.agents },
  };
  for (const [role, slot] of Object.entries(patch.agents ?? {})) {
    out.agents[role] = { ...base.agents[role], ...slot };
  }
  return out;
}

// Loads the per-agent + large model selection and persists edits via POST /api/models.
export function useModels(): {
  models: ModelConfig | null;
  error: string | null;
  saving: boolean;
  update: (target: string, patch: Partial<ModelSlot>) => void;
  patchMany: (patch: Partial<ModelConfig>) => void;
  reload: () => void;
} {
  const [models, setModels] = useState<ModelConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Re-fetch the active config (used after a stack is loaded server-side, which replaces run_config).
  const reload = useCallback(() => {
    fetchModels()
      .then(setModels)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

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

  // Apply several slots in one POST (e.g. "use this provider for all roles"), atomic server-side.
  const patchMany = useCallback(
    (patch: Partial<ModelConfig>) => {
      if (!models) return;
      setModels(applyPatch(models, patch));
      setSaving(true);
      saveModels(patch)
        .then((saved) => setModels(saved))
        .catch((e) => setError(String(e)))
        .finally(() => setSaving(false));
    },
    [models],
  );

  return { models, error, saving, update, patchMany, reload };
}
