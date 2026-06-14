import {
  AGENT_ROLES,
  type AgentState,
  type ChallengerState,
  type FeedItem,
  type QuartetEvent,
  type Role,
  type RoomState,
} from "./types";

function freshAgent(): AgentState {
  return {
    connected: false,
    joined: false,
    phase: "idle",
    llmCalls: 0,
    tokens: 0,
    posts: 0,
    received: 0,
    lastPreview: "",
    model: "",
  };
}

function freshChallenger(): ChallengerState {
  return { started: false, active: false, model: "", tokens: 0, durationMs: 0, solution: "", verdict: null };
}

export function initialRoom(): RoomState {
  return {
    agents: {
      spec: freshAgent(),
      coder: freshAgent(),
      tester: freshAgent(),
      repairer: freshAgent(),
      conductor: freshAgent(),
    },
    feed: [],
    totalTokens: 0,
    code: { state: "idle", preview: "", runs: 0, cases: [], nTotal: 0, nFail: 0 },
    challenger: freshChallenger(),
    models: {},
    verdict: null,
    finished: false,
    taskId: null,
    activeRole: null,
    roundTrips: 0,
  };
}

const MENTION = /@\[\[[^\]]+\]\]|@\w+/g;

function mentionsOf(ev: QuartetEvent): string[] {
  if (ev.mentions && ev.mentions.length) return ev.mentions;
  return (ev.preview?.match(MENTION) ?? []).map((m) =>
    m.replace(/^@\[\[/, "@").replace(/\]\]$/, ""),
  );
}

let feedId = 0;
export function resetFeedId() {
  feedId = 0;
}

// The lone large model races on event role "single_large"; fold it into its own slice so the agent
// maps stay clean.
function reduceChallenger(prev: RoomState, ev: QuartetEvent): RoomState {
  const c: ChallengerState = { ...prev.challenger };
  switch (ev.type) {
    case "baseline_started":
      c.started = true;
      c.active = true;
      c.model = ev.model ?? c.model;
      break;
    case "llm_call":
      c.tokens += ev.total_tokens ?? 0;
      c.durationMs = ev.duration_ms ?? c.durationMs;
      c.active = true;
      break;
    case "baseline_solution":
      c.solution = ev.preview ?? c.solution;
      break;
    case "scored":
      c.verdict = ev.passed ? "pass" : "fail";
      c.active = false;
      break;
  }
  return { ...prev, challenger: c };
}

// Pure reducer: fold one event into the room snapshot. Returns a NEW state object (and new nested
// objects only where they change) so React re-renders the right cards.
export function reduceRoom(prev: RoomState, ev: QuartetEvent): RoomState {
  if (ev.role === ("single_large" as Role)) return reduceChallenger(prev, ev);

  const state: RoomState = { ...prev, agents: { ...prev.agents } };
  const role = ev.role as Role;
  const setAgent = (r: Role, patch: Partial<AgentState>) => {
    state.agents[r] = { ...state.agents[r], ...patch };
  };
  const pushFeed = (item: Omit<FeedItem, "id">) => {
    state.feed = [...state.feed, { ...item, id: feedId++ }];
  };

  switch (ev.type) {
    case "run_started":
      if (ev.models) {
        state.models = ev.models;
        for (const r of AGENT_ROLES) if (ev.models[r]) setAgent(r, { model: ev.models[r] });
        if (ev.models["single_large"]) {
          state.challenger = { ...state.challenger, model: ev.models["single_large"] };
        }
      }
      break;

    case "agent_connected":
      setAgent(role, { connected: true, phase: "connected" });
      break;

    case "room_joined":
      setAgent(role, { connected: true, joined: true });
      break;

    case "message_received":
      if (role !== "conductor") {
        setAgent(role, { phase: "receiving", joined: true, received: state.agents[role].received + 1 });
        state.activeRole = role;
      }
      pushFeed({
        kind: "received",
        role,
        from: ev.sender ?? "?",
        preview: ev.preview ?? "",
        mentions: mentionsOf(ev),
        ts: ev.ts,
      });
      break;

    case "llm_call": {
      const t = ev.total_tokens ?? 0;
      setAgent(role, {
        phase: "thinking",
        llmCalls: state.agents[role].llmCalls + 1,
        tokens: state.agents[role].tokens + t,
        model: ev.model || state.agents[role].model,
      });
      state.totalTokens = state.totalTokens + t;
      state.activeRole = role;
      break;
    }

    case "message_posted":
      if (role !== "conductor") {
        setAgent(role, {
          phase: "posted",
          posts: state.agents[role].posts + 1,
          lastPreview: ev.preview ?? "",
        });
        state.activeRole = role;
        if (role === "coder") {
          state.code = { ...state.code, preview: ev.preview ?? state.code.preview };
        }
      }
      pushFeed({
        kind: "posted",
        role,
        from: role,
        preview: ev.preview ?? "",
        mentions: mentionsOf(ev),
        ts: ev.ts,
      });
      break;

    case "tool_call":
      if (ev.tool === "run_tests" && ev.result) {
        const cases = ev.result.cases ?? [];
        state.code = {
          ...state.code,
          state: ev.result.passed ? "pass" : "fail",
          runs: state.code.runs + 1,
          cases,
          nTotal: ev.result.n_total ?? cases.length,
          nFail: ev.result.n_fail ?? cases.filter((c) => !c.passed).length,
        };
        state.roundTrips = state.roundTrips + 1;
        setAgent("repairer", { phase: "testing" });
        state.activeRole = "repairer";
      }
      break;

    case "terminal_emitted":
      setAgent("repairer", { phase: "final" });
      state.activeRole = "repairer";
      break;

    case "scored":
      state.verdict = ev.passed ? "pass" : "fail";
      state.finished = true;
      break;
  }

  if (ev.task_id) state.taskId = ev.task_id;
  return state;
}

export function reduceAll(events: QuartetEvent[]): RoomState {
  resetFeedId();
  return events.reduce(reduceRoom, initialRoom());
}

export { AGENT_ROLES };
