import { useEffect, useState, type ReactNode } from "react";
import { configColor, fmtPct, fmtUsd } from "../theme";
import { useResults } from "../useResults";
import type { ConfigResult } from "../types";

type Metric = "pass" | "cost";

export function ResultsView({ animate = true }: { animate?: boolean }) {
  const { configs, error } = useResults();
  const [metric, setMetric] = useState<Metric>("pass");
  const [mounted, setMounted] = useState(!animate);
  const animClass = animate ? "animate-stationIn" : "";

  useEffect(() => {
    if (animate && configs.length > 0) {
      const t = setTimeout(() => setMounted(true), 50);
      return () => clearTimeout(t);
    }
  }, [animate, configs.length]);

  const anySample = configs.some((c) => c.source === "sample");
  const value = (c: ConfigResult) => (metric === "pass" ? c.pass_rate : c.cost_per_solved);
  const fmt = (c: ConfigResult) => (metric === "pass" ? fmtPct(c.pass_rate) : fmtUsd(c.cost_per_solved));
  const max = Math.max(...configs.map(value), metric === "pass" ? 1 : 0.0001);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[13px] uppercase tracking-[0.25em] text-[var(--text-3)]">
            HumanEval benchmark
          </div>
          <h2 className="font-display text-3xl font-bold text-[var(--text)]">
            {metric === "pass" ? "Pass@1 by configuration" : "Cost per solved problem"}
          </h2>
          <p className="mt-1 text-sm text-[var(--text-2)]">
            {metric === "pass"
              ? "A quartet of small models against a single small and a single large model."
              : "Tokens times model price, divided by problems solved. Lower is better."}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-[var(--line)] bg-black/40 p-1">
          <Seg active={metric === "pass"} onClick={() => setMetric("pass")}>
            Pass@1
          </Seg>
          <Seg active={metric === "cost"} onClick={() => setMetric("cost")}>
            Cost / solved
          </Seg>
        </div>
      </div>

      {error && <div className="font-mono text-sm text-fail">{error}</div>}

      <div className="space-y-6">
        {configs.map((c, index) => (
          <div key={c.key} className={animClass} style={animate ? { animationDelay: `${index * 120}ms` } : undefined}>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="font-display text-lg font-semibold text-[var(--text)]">{c.label}</span>
                <span className="font-mono text-[13px] text-[var(--text-3)]">{c.model}</span>
                {c.source === "sample" && <SampleBadge />}
              </div>
              <span
                className="font-mono text-xl font-semibold tabular-nums"
                style={{ color: configColor[c.key] }}
              >
                {fmt(c)}
              </span>
            </div>
            <div className="h-9 overflow-hidden rounded-lg border border-[var(--line)] bg-black/60">
              <div
                className="flex h-full items-center justify-end rounded-r-lg px-3 font-mono text-[13px] font-semibold text-black transition-all duration-700 ease-spring"
                style={{ width: mounted ? `${Math.max((value(c) / max) * 100, 5)}%` : "0%", background: configColor[c.key] }}
              >
                {c.pass_count}/{c.total}
              </div>
            </div>
          </div>
        ))}
      </div>

      {anySample && (
        <p className="mt-7 font-mono text-[13px] leading-relaxed text-[var(--text-3)]">
          bars marked <span className="text-tester">sample</span> are illustrative placeholders. run{" "}
          <span className="text-[var(--text-2)]">uv run python -m bench.baselines</span> and the
          Quartet over the full benchmark to replace them with measured numbers.
        </p>
      )}
    </div>
  );
}

function SampleBadge() {
  return (
    <span className="rounded bg-tester/15 px-1.5 py-0.5 font-mono text-[12px] font-semibold uppercase tracking-wide text-tester">
      sample
    </span>
  );
}

function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-3 py-1.5 text-sm font-semibold transition-all duration-300 ease-spring ${
        active ? "bg-repairer/15 text-repairer shadow-[inset_0_0_0_1px_rgba(52,211,153,0.3)]" : "text-[var(--text-3)] hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}
