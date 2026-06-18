import type { Phase, Role } from "./types";

export const roleMeta: Record<Role, { label: string; color: string; sub: string }> = {
  spec: { label: "Spec", color: "#38bdf8", sub: "restate, list edge cases" },
  coder: { label: "Coder", color: "#a78bfa", sub: "write the implementation" },
  tester: { label: "Tester", color: "#fbbf24", sub: "adversarial test cases" },
  repairer: { label: "Repairer", color: "#34d399", sub: "run tests, conduct loop" },
  conductor: { label: "Conductor", color: "#8b94a3", sub: "drive the benchmark" },
};

// Left-to-right signal path through the room.
export const signalOrder: Role[] = ["spec", "coder", "tester", "repairer"];

// Phases where an agent is actively working (drives the pulsing dot and the "thinking" circle).
export const ACTIVE_PHASES: Set<Phase> = new Set(["receiving", "thinking", "testing"]);

export const phaseLabel: Record<Phase, string> = {
  idle: "OFFLINE",
  connected: "READY",
  receiving: "READING",
  thinking: "THINKING",
  posted: "HANDED OFF",
  testing: "RUN TESTS",
  final: "FINAL",
};

// Config bar / column colors for the results and compare views.
export const configColor: Record<string, string> = {
  single_small: "#64748b",
  quartet: "#34d399",
  single_large: "#a78bfa",
};

export const fmtInt = (n: number): string => n.toLocaleString("en-US");

export function fmtUsd(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

export const fmtPct = (rate: number): string => `${(rate * 100).toFixed(1)}%`;
