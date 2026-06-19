import type {
  ConfigResult,
  KeyStatus,
  LabResult,
  ModelConfig,
  PricingTable,
  ProjectFileContent,
  ProjectInfo,
  ProviderModels,
  QuartetEvent,
  RunInfo,
  RunStatus,
  StackInfo,
  Transcript,
  ValidateResult,
} from "./types";

// The demo server runs on the presenter's machine. When the frontend is deployed (e.g. Vercel) it
// talks to that machine through a tunnel: set VITE_API_BASE to the tunnel URL at build time. Empty
// (local dev / served from the demo server) means same origin, with Vite proxying /api.
export const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

// Shared access token for the control plane over the tunnel (X-Quartet-Token). Held in memory and
// mirrored to localStorage so a reload keeps it; never sent anywhere but the demo server.
const _TOKEN_KEY = "quartet_api_token";
let _token = (typeof localStorage !== "undefined" && localStorage.getItem(_TOKEN_KEY)) || "";

export function setApiToken(token: string): void {
  _token = token || "";
  try {
    if (_token) localStorage.setItem(_TOKEN_KEY, _token);
    else localStorage.removeItem(_TOKEN_KEY);
  } catch {
    /* localStorage may be unavailable; the in-memory token still works for this session */
  }
}

export function getApiToken(): string {
  return _token;
}

export function apiUrl(path: string): string {
  return path.startsWith("http") ? path : API_BASE + path;
}

function _headers(json: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  if (_token) h["X-Quartet-Token"] = _token;
  return h;
}

async function getJson<T>(url: string, label: string): Promise<T> {
  const r = await fetch(apiUrl(url), { headers: _headers(false) });
  if (!r.ok) throw new Error(`${label}: ${r.status}`);
  return r.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown, label: string): Promise<T> {
  const r = await fetch(apiUrl(url), {
    method: "POST",
    headers: _headers(true),
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

// ---- stack lab (benchmark a stack over a HumanEval subset; persisted per stack) ----

export function runLab(stack: string, n: number): Promise<RunStatus> {
  return postJson<RunStatus>("/api/lab/run", { stack, n }, "lab run");
}

export function fetchLabResults(): Promise<LabResult[]> {
  return getJson<{ results: LabResult[] }>("/api/lab/results", "lab results").then((d) => d.results ?? []);
}

export function fetchPricing(): Promise<PricingTable> {
  return getJson<PricingTable>("/api/lab/pricing", "pricing");
}

export function savePricing(model: string, input: number, output: number): Promise<PricingTable> {
  return postJson<PricingTable>("/api/lab/pricing", { model, input, output }, "save pricing");
}

export function startRun(taskId: string): Promise<RunStatus> {
  return postJson<RunStatus>("/api/run", { task_id: taskId }, "run");
}

export function stopRun(): Promise<RunStatus> {
  return postJson<RunStatus>("/api/stop", {}, "stop");
}

// ---- build workspace ----

export function startBuild(description: string, projectType: string, stack?: Partial<ModelConfig>): Promise<RunStatus> {
  return postJson<RunStatus>("/api/build", { description, project_type: projectType, stack }, "build");
}

// Conversational build: the user talks to the Orchestrator, which replies and kicks off the build.
// Returns the run status plus the Orchestrator's reply (also written into the run transcript).
export type BuildChatResult = RunStatus & { reply: string; description: string; project_type: string; needs_confirmation?: boolean };

export function buildChat(
  message: string,
  projectType: string,
  stack?: Partial<ModelConfig>,
  runId?: string | null,
  confirm?: boolean,
  description?: string,
): Promise<BuildChatResult> {
  // description carries the Orchestrator's normalized request on the Confirm step, where the user
  // typed nothing new (message is empty). Without it the server would start an empty build.
  return postJson<BuildChatResult>(
    "/api/build/chat",
    { message, project_type: projectType, stack, run_id: runId, confirm, description },
    "build chat",
  );
}

export function fetchProject(runId: string): Promise<ProjectInfo> {
  return getJson<ProjectInfo>(`/api/project?run_id=${encodeURIComponent(runId)}`, "project");
}

export function fetchProjectFile(runId: string, path: string): Promise<ProjectFileContent> {
  return getJson<ProjectFileContent>(
    `/api/project/file?run_id=${encodeURIComponent(runId)}&path=${encodeURIComponent(path)}`,
    "project file",
  );
}

export function projectZipUrl(runId: string): string {
  return apiUrl(`/api/project/zip?run_id=${encodeURIComponent(runId)}`);
}

export function projectPreviewUrl(runId: string, path = "index.html"): string {
  return apiUrl(`/api/project/preview/${encodeURIComponent(runId)}/${path}`);
}

// SSE endpoint, used for live tailing of an active conductor run.
export function liveStreamUrl(runId: string): string {
  return apiUrl(`/api/stream?run_id=${encodeURIComponent(runId)}&mode=live`);
}
