// Shapes mirror the JSONL event schema emitted by bench/events.py and the conductor. The demo only
// reads these; it never writes telemetry.

export type Role = "spec" | "coder" | "tester" | "repairer" | "conductor";

export const AGENT_ROLES: Role[] = ["spec", "coder", "tester", "repairer"];

export interface QuartetEvent {
  ts: string;
  run_id: string;
  room_id: string | null;
  task_id: string | null;
  role: Role;
  type:
    | "agent_connected"
    | "room_joined"
    | "run_started"
    | "message_received"
    | "llm_call"
    | "message_posted"
    | "tool_call"
    | "terminal_emitted"
    | "baseline_started"
    | "baseline_solution"
    | "scored";
  // type-specific extras (all optional)
  sender?: string;
  preview?: string;
  mentions?: string[];
  model?: string;
  models?: Record<string, string>; // run_started: role -> model (incl. single_large)
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  duration_ms?: number;
  tool?: string;
  args_summary?: string;
  result?: {
    passed?: boolean;
    timed_out?: boolean;
    cases?: TestCase[];
    n_total?: number;
    n_fail?: number;
    first_fail?: string | null;
  };
  kind?: string; // terminal_emitted: FINAL_SOLUTION | NO_SOLUTION
  passed?: boolean; // scored
  status?: string; // scored
}

export interface TestCase {
  name: string;
  passed: boolean;
  error: string | null;
}

export interface RunInfo {
  run_id: string;
  file: string;
  mtime: number;
  events: number;
  complete: boolean;
  task_id: string | null;
  kind: "demo" | "run";
}

export interface ConfigResult {
  key: string;
  label: string;
  model: string;
  pass_rate: number;
  pass_count: number;
  total: number;
  total_tokens: number;
  cost_usd: number;
  cost_per_solved: number;
  source: "real" | "sample";
}

export type Phase =
  | "idle"
  | "connected"
  | "receiving"
  | "thinking"
  | "posted"
  | "testing"
  | "final";

export interface AgentState {
  connected: boolean;
  joined: boolean;
  phase: Phase;
  llmCalls: number;
  tokens: number;
  posts: number;
  received: number;
  lastPreview: string;
  model: string;
}

// The lone large model racing the Quartet on the same problem (event role "single_large").
export interface ChallengerState {
  started: boolean;
  active: boolean;
  model: string;
  tokens: number;
  durationMs: number;
  solution: string;
  verdict: "pass" | "fail" | null;
}

export interface FeedItem {
  id: number;
  kind: "received" | "posted";
  role: Role;
  from: string;
  preview: string;
  mentions: string[];
  ts: string;
}

// ---- control plane ----

// The selectable providers (all OpenAI-compatible). aimlapi is the closed-source path.
export const PROVIDERS = ["local", "groq", "aimlapi", "gemini", "openrouter", "openai_compatible"] as const;
export type Provider = (typeof PROVIDERS)[number];

// Providers that need an API key / base_url entered from the dashboard.
export const KEYED_PROVIDERS = ["groq", "aimlapi", "gemini", "openrouter", "openai_compatible"] as const;

export interface ModelSlot {
  provider: string;
  model: string;
}

export interface ModelConfig {
  name?: string; // active stack label
  agents: Record<string, ModelSlot>; // spec / coder / tester / repairer
  large: ModelSlot;
}

// A named, saved model selection (results/stacks/<name>.json). Same shape as ModelConfig, key-free.
export interface StackInfo {
  name: string;
  mtime: number;
  providers: string[];
}

// Per-provider key presence (booleans + the non-secret openai_compatible base_url). Never a key value.
export interface KeyStatus {
  [provider: string]: { has_key: boolean; base_url?: string };
}

export interface ProviderModels {
  models: string[];
  note?: string;
}

export interface ValidateResult {
  ok: boolean;
  detail: string;
}

export interface AgentProc {
  role: string;
  pid: number;
  alive: boolean;
}

// ---- build workspace ----

export interface ProjectFile {
  path: string;
  size: number;
}

export interface ProjectInfo {
  run_id: string;
  type?: string | null; // python | static
  passed?: boolean | null;
  description?: string;
  files: ProjectFile[];
  readme: string;
  has_static_entry: boolean;
  zip: string;
  missing?: boolean;
}

export interface ProjectFileContent {
  path: string;
  content: string;
}

export interface LabProgress {
  done: number;
  total: number;
  passed: number;
  problems: { task_id: string; passed: boolean; status?: string | null; latency_ms?: number }[];
}

export interface RunStatus {
  status: string; // idle | starting | running | done | error | stopped
  run_id: string | null;
  task_id: string | null;
  active: boolean;
  agents: AgentProc[];
  warnings?: string[];
  error?: string | null;
  result?: { passed?: boolean; status?: string } | null;
  mode?: string; // "race" | "build" | "lab"
  stack?: string;
  lab?: LabProgress | null;
}

// ---- stack lab ----

export interface LabReference {
  source: "estimate";
  basis: string; // "baselines.json" | "heuristic"
  model: string;
  provider: string;
  pass_rate: number | null;
  pass_count: number | null;
  n_total: number;
  total_tokens: number;
  cost_usd: number;
  cost_per_solved: number | null;
}

export interface LabResult {
  stack: string;
  run_id: string;
  ts: string;
  source: "real";
  n_total: number;
  subset: string[];
  models: Record<string, ModelSlot>; // spec/coder/tester/repairer + large
  pass_count: number;
  pass_rate: number;
  tokens: { prompt: number; completion: number; total: number };
  cost_usd: number;
  cost_per_solved: number;
  by_role: Record<string, { prompt: number; completion: number; total: number; cost_usd: number }>;
  latency: { total_ms: number; avg_ms: number };
  per_problem: { task_id: string; passed: boolean; status?: string | null; latency_ms?: number }[];
  reference: LabReference;
}

// The editable per-model price table (dollars per 1M input/output tokens). Not a secret.
export interface PricingTable {
  _note?: string;
  [model: string]: { input: number; output: number } | string | undefined;
}

export interface TranscriptMessage {
  ts: string | null;
  role: string;
  sender: string;
  sender_type?: string;
  content: string;
  mentions: string[];
  kind: string | null;
}

export interface Transcript {
  run_id: string;
  task_id?: string;
  room_id?: string;
  prompt?: string;
  final_solution?: string;
  messages: TranscriptMessage[];
  missing?: boolean;
}

export interface RoomState {
  agents: Record<Role, AgentState>;
  feed: FeedItem[];
  totalTokens: number;
  code: {
    state: "idle" | "fail" | "pass";
    preview: string;
    runs: number;
    cases: TestCase[];
    nTotal: number;
    nFail: number;
  };
  challenger: ChallengerState;
  models: Record<string, string>;
  verdict: "pass" | "fail" | null;
  finished: boolean;
  taskId: string | null;
  activeRole: Role | null;
  roundTrips: number; // run_tests invocations = repair rounds observed
}
