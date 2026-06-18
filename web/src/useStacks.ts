import { useCallback, useEffect, useState } from "react";
import {
  duplicateStack,
  fetchKeys,
  fetchProviderModels,
  fetchStacks,
  loadStack,
  saveKey,
  saveStack,
  validateProvider,
} from "./api";
import type { KeyStatus, ModelConfig, ProviderModels, StackInfo } from "./types";

// Named stacks + provider key store + per-provider model lists for the "Build your stack" panel.
// Keys are write-only from the client: we send them, but only ever read back has_key booleans.
export function useStacks() {
  const [stacks, setStacks] = useState<StackInfo[]>([]);
  const [keys, setKeys] = useState<KeyStatus>({});
  const [providerModels, setProviderModels] = useState<Record<string, ProviderModels>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStacks = useCallback(
    () => fetchStacks().then(setStacks).catch((e) => setError(String(e))),
    [],
  );
  const refreshKeys = useCallback(
    () => fetchKeys().then(setKeys).catch((e) => setError(String(e))),
    [],
  );

  useEffect(() => {
    refreshStacks();
    refreshKeys();
  }, [refreshStacks, refreshKeys]);

  // Lazy-fetch a provider's model id list once (force to re-fetch after a key change). Local and
  // keyless providers come back with an empty list + a note, which the dropdown falls back from.
  const loadProviderModels = useCallback(
    (provider: string, force = false): Promise<ProviderModels> => {
      if (!force && providerModels[provider]) return Promise.resolve(providerModels[provider]);
      return fetchProviderModels(provider)
        .then((pm) => {
          setProviderModels((prev) => ({ ...prev, [provider]: pm }));
          return pm;
        })
        .catch((e) => {
          const pm = { models: [], note: String(e) };
          setProviderModels((prev) => ({ ...prev, [provider]: pm }));
          return pm;
        });
    },
    [providerModels],
  );

  const saveProviderKey = useCallback((provider: string, apiKey: string, baseUrl?: string) => {
    setBusy(true);
    return saveKey(provider, apiKey, baseUrl)
      .then((s) => {
        setKeys(s);
        return loadProviderModels(provider, true); // refresh the dropdown now the key is set
      })
      .catch((e) => {
        setError(String(e));
        return { models: [] as string[] };
      })
      .finally(() => setBusy(false));
    // loadProviderModels intentionally omitted: a fresh closure each call is fine here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validate = useCallback((provider: string) => validateProvider(provider), []);

  const saveAs = useCallback((name: string, config: Partial<ModelConfig>) => {
    setBusy(true);
    return saveStack(name, config)
      .then((r) => {
        setStacks(r.stacks);
        return r.saved;
      })
      .catch((e) => {
        setError(String(e));
        return null;
      })
      .finally(() => setBusy(false));
  }, []);

  const load = useCallback((name: string) => loadStack(name), []);

  const duplicate = useCallback((name: string, newName: string) => {
    setBusy(true);
    return duplicateStack(name, newName)
      .then((r) => {
        setStacks(r.stacks);
        return r.saved;
      })
      .catch((e) => {
        setError(String(e));
        return null;
      })
      .finally(() => setBusy(false));
  }, []);

  return {
    stacks,
    keys,
    providerModels,
    busy,
    error,
    refreshStacks,
    refreshKeys,
    loadProviderModels,
    saveProviderKey,
    validate,
    saveAs,
    load,
    duplicate,
  };
}
