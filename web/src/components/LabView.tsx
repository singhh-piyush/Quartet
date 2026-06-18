import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fmtInt, fmtPct, fmtUsd } from "../theme";
import type { LabResult, ModelConfig, ModelSlot, Role, RunStatus } from "../types";
import { useLab } from "../useLab";
import { useLiveRun } from "../useLiveRun";
import { useStacks } from "../useStacks";
import { useTranscript } from "../useTranscript";
import { AgentRail } from "./AgentRail";
import { BandRoom } from "./BandRoom";
import { PricingTable } from "./PricingTable";
import { StackBuilder } from "./StackBuilder";

const SIZES = [3, 5, 10];

function fmtMs(ms: number): string {
  if (!ms) return "-";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function statusTone(status: string): { label: string; color: string; pulse: boolean } {
  switch (status) {
    case "starting":
      return { label: "starting agents", color: "var(--tester)", pulse: true };
    case "running":
      return { label: "benchmarking", color: "var(--repairer)", pulse: true };
    case "done":
      return { label: "complete", color: "var(--pass)", pulse: false };
    case "error":
      return { label: "error", color: "var(--fail)", pulse: false };
    case "stopped":
      return { label: "stopped", color: "var(--text-3)", pulse: false };
    default:
      return { label: "ready", color: "var(--text-3)", pulse: false };
  }
}

// The Stack Lab: pick a saved stack, run it (the quartet via Band) over a HumanEval subset with held-out
// scoring, and read Pass@1 / cost / latency. Results persist per stack so the leaderboard compares them
// without re-running. The single large model is an estimate (no run), always labeled.
export function LabView({
  status,
  models,
  saving,
  onUpdate,
  onPatchMany,
  onReloadModels,
  startLab,
  stop,
}: {
  status: RunStatus;
  models: ModelConfig | null;
  saving: boolean;
  onUpdate: (target: string, patch: Partial<ModelSlot>) => void;
  onPatchMany: (patch: Partial<ModelConfig>) => void;
  onReloadModels: () => void;
  startLab: (stack: string, n: number) => Promise<RunStatus>;
  stop: () => void;
}) {
  const sx = useStacks();
  const { results, pricing, refreshResults, updatePrice } = useLab();
  const [stack, setStack] = useState("");
  const [n, setN] = useState(5);
  const [liveRunId, setLiveRunId] = useState<string | null>(null);
  const [showStack, setShowStack] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const [focusStack, setFocusStack] = useState<string | null>(null);
  const [agentFocus, setAgentFocus] = useState<Role | null>(null);

  const isLab = status.mode === "lab";
  const active = isLab && (status.active || status.status === "starting");
  const tone = statusTone(isLab ? status.status : "idle");
  const live = useLiveRun(active ? liveRunId : null);
  const pollTranscript = !!liveRunId && active;
  const { transcript } = useTranscript(liveRunId, !active, pollTranscript);

  // Default the stack picker to the first saved stack.
  useEffect(() => {
    if (!stack && sx.stacks.length) setStack(sx.stacks[0].name);
  }, [sx.stacks, stack]);

  // When a lab run finishes, pull the freshly persisted result in and focus it.
  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && !active && status.status === "done") {
      refreshResults();
      if (status.stack) setFocusStack(status.stack);
    }
    wasActive.current = active;
  }, [active, status.status, status.stack, refreshResults]);

  const onRun = async () => {
    if (!stack) return;
    try {
      const s = await startLab(stack, n);
      if (s.run_id) setLiveRunId(s.run_id);
    } catch {
      /* surfaced via status */
    }
  };

  const focused = useMemo(
    () => results.find((r) => r.stack === focusStack) ?? results[0] ?? null,
    [results, focusStack],
  );

  return (
    <div className="h-full space-y-3.5 overflow-y-auto pr-1">
      {/* controls */}
      <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${tone.pulse ? "animate-blip" : ""}`} style={{ background: tone.color }} />
            <span className="font-mono text-[12px] uppercase tracking-widest" style={{ color: tone.color }}>
              {tone.label}
            </span>
          </span>

          <span className="hidden h-5 w-px bg-[var(--line)] sm:block" />

          <label className="flex items-center gap-2">
            <span className="font-mono text-[11px] uppercase tracking-widest text-[var(--text-3)]">stack</span>
            <select
              value={stack}
              disabled={active}
              onChange={(e) => setStack(e.target.value)}
              className="min-w-[10rem] rounded-md border border-[var(--line)] bg-black/60 px-2.5 py-1.5 font-mono text-[12.5px] text-[var(--text)] outline-none focus:border-[var(--line-strong)] disabled:opacity-50"
            >
              {sx.stacks.length === 0 && <option value="">no saved stacks - build one</option>}
              {sx.stacks.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} ({s.providers.join("+")})
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-widest text-[var(--text-3)]">problems</span>
            {SIZES.map((s) => (
              <button
                key={s}
                disabled={active}
                onClick={() => setN(s)}
                className={`rounded-md px-2.5 py-1 font-mono text-[12px] transition-colors disabled:opacity-50 ${
                  n === s ? "bg-white/10 text-white" : "text-[var(--text-3)] hover:text-[var(--text-2)]"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {active ? (
            <button
              onClick={stop}
              className="rounded-lg border border-fail/50 bg-fail/10 px-4 py-1.5 font-sans text-sm font-semibold text-fail transition-colors hover:bg-fail/20"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={onRun}
              disabled={!stack}
              className="rounded-lg bg-repairer px-4 py-1.5 font-sans text-sm font-semibold text-black shadow-[0_0_24px_-8px_var(--repairer)] transition-transform hover:scale-[1.02] disabled:opacity-40"
            >
              Run benchmark
            </button>
          )}

          <div className="ml-auto flex items-center gap-3">
            <Toggle on={showStack} onClick={() => setShowStack((s) => !s)}>
              Stack
            </Toggle>
            <Toggle on={showPricing} onClick={() => setShowPricing((s) => !s)}>
              Pricing
            </Toggle>
          </div>
        </div>

        {isLab && status.warnings && status.warnings.length > 0 && (
          <div className="mt-3 space-y-1">
            {status.warnings.map((w, i) => (
              <div key={i} className="rounded-md border border-tester/30 bg-tester/10 px-3 py-1.5 font-mono text-[12px] text-tester">
                {w}
              </div>
            ))}
          </div>
        )}
        {isLab && status.status === "error" && status.error && (
          <div className="mt-3 rounded-md border border-fail/40 bg-fail/10 px-3 py-1.5 font-mono text-[12px] text-fail">
            {status.error}
          </div>
        )}

        {/* live progress */}
        {active && status.lab && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="font-mono text-[12px] text-[var(--text-2)]">
              solved <span className="text-pass">{status.lab.passed}</span> / {status.lab.done} done of {status.lab.total}
            </span>
            <div className="flex flex-wrap items-center gap-1">
              {Array.from({ length: status.lab.total }).map((_, i) => {
                const p = status.lab?.problems[i];
                const bg = !p ? "rgba(255,255,255,0.12)" : p.passed ? "var(--pass)" : "var(--fail)";
                return <span key={i} className="h-2 w-5 rounded-sm" style={{ background: bg }} title={p?.task_id} />;
              })}
            </div>
          </div>
        )}

        {showStack && (
          <div className="mt-3">
            <StackBuilder
              models={models}
              status={status}
              saving={saving}
              onUpdate={onUpdate}
              onPatchMany={onPatchMany}
              onReloadModels={onReloadModels}
            />
          </div>
        )}
        {showPricing && (
          <div className="mt-3">
            <PricingTable pricing={pricing} onUpdate={updatePrice} />
          </div>
        )}
      </section>

      {/* live reasoning (only while a lab run streams) */}
      {active && (
        <>
          <AgentRail room={live.room} focus={agentFocus} onFocus={(r) => setAgentFocus((f) => (f === r ? null : r))} />
          <div className="min-h-[40vh]">
            <BandRoom transcript={transcript} room={live.room} live={true} focus={agentFocus} />
          </div>
        </>
      )}

      {/* focused result detail */}
      {focused && <ResultDetail r={focused} />}

      {/* leaderboard: every saved stack ranked */}
      {results.length > 0 ? (
        <Leaderboard results={results} focused={focused?.stack ?? null} onFocus={setFocusStack} />
      ) : (
        !active && (
          <section className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--panel)] p-6 text-center">
            <p className="font-mono text-[13px] text-[var(--text-3)]">
              no lab runs yet. pick a stack and run a benchmark to populate the leaderboard.
            </p>
          </section>
        )
      )}
    </div>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 font-sans text-sm font-semibold transition-colors ${
        on ? "border-[var(--line-strong)] text-white" : "border-[var(--line)] text-[var(--text-2)] hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div>
      <div className="font-mono text-2xl font-bold tabular-nums" style={{ color: color ?? "var(--text)" }}>
        {value}
      </div>
      <div className="font-mono text-[11px] uppercase tracking-widest text-[var(--text-3)]">{label}</div>
      {sub && <div className="mt-0.5 font-mono text-[11px] text-[var(--text-3)]">{sub}</div>}
    </div>
  );
}

function ResultDetail({ r }: { r: LabResult }) {
  const ref = r.reference;
  const roleOrder = ["spec", "coder", "tester", "repairer"] as const;
  return (
    <section className="space-y-4 rounded-xl border border-repairer/40 bg-[var(--panel)] p-5" style={{ boxShadow: "0 0 50px -30px var(--repairer)" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-display text-xl font-bold text-[var(--text)]">{r.stack}</span>
            <RealBadge />
          </div>
          <div className="mt-1 font-mono text-[12px] text-[var(--text-3)]">
            {r.n_total} problems · {new Date(r.ts).toLocaleString()}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {roleOrder.map((role) => (
            <span key={role} className="rounded-md border border-[var(--line)] bg-black/40 px-2 py-1 font-mono text-[10.5px] text-[var(--text-2)]">
              {role}: {r.models[role]?.model}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Pass@1" value={fmtPct(r.pass_rate)} sub={`${r.pass_count}/${r.n_total} solved`} color="var(--repairer)" />
        <Stat label="cost / solved" value={fmtUsd(r.cost_per_solved)} sub={`${fmtUsd(r.cost_usd)} total`} color="var(--spec)" />
        <Stat label="tokens" value={fmtInt(r.tokens.total)} sub={`${fmtInt(r.tokens.prompt)} in / ${fmtInt(r.tokens.completion)} out`} />
        <Stat label="avg latency" value={fmtMs(r.latency.avg_ms)} sub={`${fmtMs(r.latency.total_ms)} total`} />
      </div>

      {/* single large reference (estimate, no run) */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-[var(--line)] bg-black/30 px-4 py-2.5">
        <span className="flex items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-widest text-[var(--text-3)]">single large</span>
          <EstimateBadge />
        </span>
        <span className="font-mono text-[12px] text-[var(--text-2)]">{ref.model}</span>
        <span className="font-mono text-[12px] text-[var(--text-3)]">
          Pass@1 {ref.pass_rate == null ? "n/a" : fmtPct(ref.pass_rate)}
        </span>
        <span className="font-mono text-[12px] text-[var(--text-3)]">
          cost / solved {ref.cost_per_solved == null ? "n/a" : fmtUsd(ref.cost_per_solved)}
        </span>
        <span className="font-mono text-[12px] text-[var(--text-3)]">~{fmtInt(ref.total_tokens)} tokens</span>
        <span className="ml-auto font-mono text-[10.5px] text-[var(--text-3)]">basis: {ref.basis}</span>
      </div>
    </section>
  );
}

interface Col {
  key: string;
  label: string;
  value: (r: LabResult) => number;
  fmt: (r: LabResult) => string;
  lowerBetter: boolean;
  eligible?: (r: LabResult) => boolean;
}

const COLS: Col[] = [
  { key: "pass", label: "Pass@1", value: (r) => r.pass_rate, fmt: (r) => fmtPct(r.pass_rate), lowerBetter: false },
  {
    key: "cps",
    label: "cost / solved",
    value: (r) => r.cost_per_solved,
    fmt: (r) => fmtUsd(r.cost_per_solved),
    lowerBetter: true,
    eligible: (r) => r.cost_per_solved > 0,
  },
  { key: "cost", label: "total cost", value: (r) => r.cost_usd, fmt: (r) => fmtUsd(r.cost_usd), lowerBetter: true, eligible: (r) => r.cost_usd > 0 },
  { key: "tokens", label: "tokens", value: (r) => r.tokens.total, fmt: (r) => fmtInt(r.tokens.total), lowerBetter: true, eligible: (r) => r.tokens.total > 0 },
  { key: "lat", label: "avg latency", value: (r) => r.latency.avg_ms, fmt: (r) => fmtMs(r.latency.avg_ms), lowerBetter: true, eligible: (r) => r.latency.avg_ms > 0 },
];

function Leaderboard({ results, focused, onFocus }: { results: LabResult[]; focused: string | null; onFocus: (s: string) => void }) {
  // The winning value per column (across eligible rows), so we can highlight the best cell.
  const best = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const c of COLS) {
      const vals = results.filter((r) => (c.eligible ? c.eligible(r) : true)).map(c.value);
      out[c.key] = vals.length ? (c.lowerBetter ? Math.min(...vals) : Math.max(...vals)) : null;
    }
    return out;
  }, [results]);

  // Rank by Pass@1, then cheaper cost per solved.
  const ranked = useMemo(
    () => [...results].sort((a, b) => b.pass_rate - a.pass_rate || (a.cost_per_solved || 1e9) - (b.cost_per_solved || 1e9)),
    [results],
  );

  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[12px] uppercase tracking-[0.22em] text-[var(--text-3)]">leaderboard</span>
        <span className="font-mono text-[11px] text-[var(--text-3)]">{results.length} stacks · best in green</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="font-mono text-[10.5px] uppercase tracking-widest text-[var(--text-3)]">
              <th className="px-2 py-1.5 text-left">stack</th>
              {COLS.map((c) => (
                <th key={c.key} className="px-2 py-1.5 text-right">
                  {c.label}
                </th>
              ))}
              <th className="px-2 py-1.5 text-right">n</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r) => (
              <tr
                key={r.stack}
                onClick={() => onFocus(r.stack)}
                className={`cursor-pointer border-t border-[var(--line)] transition-colors hover:bg-white/5 ${
                  r.stack === focused ? "bg-white/[0.04]" : ""
                }`}
              >
                <td className="px-2 py-2 font-mono text-[12.5px] text-[var(--text)]">{r.stack}</td>
                {COLS.map((c) => {
                  const eligible = c.eligible ? c.eligible(r) : true;
                  const isBest = eligible && best[c.key] != null && Math.abs(c.value(r) - (best[c.key] as number)) < 1e-9;
                  return (
                    <td
                      key={c.key}
                      className="px-2 py-2 text-right font-mono text-[12.5px] tabular-nums"
                      style={{ color: isBest ? "var(--pass)" : "var(--text-2)", fontWeight: isBest ? 700 : 400 }}
                    >
                      {c.fmt(r)}
                    </td>
                  );
                })}
                <td className="px-2 py-2 text-right font-mono text-[12px] text-[var(--text-3)]">{r.n_total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RealBadge() {
  return (
    <span className="rounded bg-repairer/15 px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-repairer">
      real
    </span>
  );
}

function EstimateBadge() {
  return (
    <span className="rounded bg-tester/15 px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-tester">
      estimate
    </span>
  );
}
