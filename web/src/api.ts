import type {
  ConfigResult,
  KeyStatus,
  ModelConfig,
  ProviderModels,
  QuartetEvent,
  RunInfo,
  RunStatus,
  StackInfo,
  Transcript,
  ValidateResult,
} from "./types";

async function getJson<T>(url: string, label: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${label}: ${r.status}`);
  return r.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown, label: string): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!r.ok) throw new Error(`${label}: ${r.status}`);
  return r.json() as Promise<T>;
}

export function fetchRuns(): Promise<RunInfo[]> {
  return getJson<RunInfo[]>("/api/runs", "runs");
}

export function fetchResults(): Promise<{ configs: ConfigResult[] }> {
  return getJson<{ configs: ConfigResult[] }>("/api/results", "results");
}

// Whole run as one ordered array - the client-side player drives pacing for smooth play/pause/scrub.
export async function fetchEvents(runId: string): Promise<QuartetEvent[]> {
  const data = await getJson<{ events?: QuartetEvent[] }>(
    `/api/events?run_id=${encodeURIComponent(runId)}`,
    "events",
  );
  return data.events ?? [];
}

export function fetchTranscript(runId: string): Promise<Transcript> {
  return getJson<Transcript>(`/api/transcript?run_id=${encodeURIComponent(runId)}`, "transcript");
}

export function fetchModels(): Promise<ModelConfig> {
  return getJson<ModelConfig>("/api/models", "models");
}

export function saveModels(cfg: Partial<ModelConfig>): Promise<ModelConfig> {
  return postJson<ModelConfig>("/api/models", cfg, "models");
}

// ---- provider keys + stacks (control plane; key values never cross the wire) ----

export function fetchKeys(): Promise<KeyStatus> {
  return getJson<KeyStatus>("/api/keys", "keys");
}

export function saveKey(provider: string, apiKey: string, baseUrl?: string): Promise<KeyStatus> {
  return postJson<KeyStatus>("/api/keys", { provider, api_key: apiKey, base_url: baseUrl }, "keys");
}

export function fetchProviderModels(provider: string): Promise<ProviderModels> {
  return getJson<ProviderModels>(`/api/provider_models?provider=${encodeURIComponent(provider)}`, "provider_models");
}

export function validateProvider(provider: string): Promise<ValidateResult> {
  return postJson<ValidateResult>("/api/validate", { provider }, "validate");
}

export function fetchStacks(): Promise<StackInfo[]> {
  return getJson<{ stacks: StackInfo[] }>("/api/stacks", "stacks").then((d) => d.stacks ?? []);
}

export function saveStack(name: string, config: Partial<ModelConfig>): Promise<{ saved: ModelConfig; stacks: StackInfo[] }> {
  return postJson("/api/stacks", { name, config }, "save stack");
}

export function loadStack(name: string): Promise<ModelConfig> {
  return postJson<ModelConfig>("/api/stacks/load", { name }, "load stack");
}

export function duplicateStack(name: string, newName: string): Promise<{ saved: ModelConfig; stacks: StackInfo[] }> {
  return postJson("/api/stacks/duplicate", { name, new_name: newName }, "duplicate stack");
}

export function fetchAgents(): Promise<RunStatus> {
  return getJson<RunStatus>("/api/agents", "agents");
}

export function startRun(taskId: string): Promise<RunStatus> {
  return postJson<RunStatus>("/api/run", { task_id: taskId }, "run");
}

export function stopRun(): Promise<RunStatus> {
  return postJson<RunStatus>("/api/stop", {}, "stop");
}

// SSE endpoint, used for live tailing of an active conductor run.
export function liveStreamUrl(runId: string): string {
  return `/api/stream?run_id=${encodeURIComponent(runId)}&mode=live`;
}
