import { useEffect, useMemo, useState } from "react";
import { configColor, fmtInt, fmtPct, fmtUsd } from "../theme";
import { useResults } from "../useResults";
import type { ConfigResult } from "../types";

interface Row {
  key: string;
  label: string;
  a: number;
  b: number;
  fmt: (c: ConfigResult) => string;
  bar: (c: ConfigResult) => number; // magnitude used for the dual bar
  lowerBetter: boolean;
}

function buildRows(a: ConfigResult, b: ConfigResult): Row[] {
  return [
    {
      key: "solved",
      label: "problems solved",
      a: a.pass_rate,
      b: b.pass_rate,
      fmt: (c) => `${c.pass_count}/${c.total}`,
      bar: (c) => c.pass_rate,
      lowerBetter: false,
    },
    {
      key: "tokens",
      label: "total tokens",
      a: a.total_tokens,
      b: b.total_tokens,
      fmt: (c) => fmtInt(c.total_tokens),
      bar: (c) => c.total_tokens,
      lowerBetter: true,
    },
    {
      key: "cost",
      label: "total cost",
      a: a.cost_usd,
      b: b.cost_usd,
      fmt: (c) => fmtUsd(c.cost_usd),
      bar: (c) => c.cost_usd,
      lowerBetter: true,
    },
    {
      key: "cost_solved",
      label: "cost per solved",
      a: a.cost_per_solved,
      b: b.cost_per_solved,
      fmt: (c) => fmtUsd(c.cost_per_solved),
      bar: (c) => c.cost_per_solved,
      lowerBetter: true,
    },
  ];
}

function verdict(a: ConfigResult, b: ConfigResult): string {
  const pp = (a.pass_rate - b.pass_rate) * 100;
  const passPhrase =
    Math.abs(pp) < 0.1
      ? `matches ${b.label} on Pass@1`
      : pp > 0
        ? `beats ${b.label} by ${pp.toFixed(1)} points on Pass@1`
        : `trails ${b.label} by ${Math.abs(pp).toFixed(1)} points on Pass@1`;
  if (!b.cost_per_solved || !a.cost_per_solved) return `${a.label} ${passPhrase}.`;
  const ratio = a.cost_per_solved / b.cost_per_solved;
  const costPhrase =
    ratio < 0.995
      ? `at ${ratio.toFixed(2)}x the cost per solved`
      : ratio > 1.005
        ? `at ${ratio.toFixed(2)}x the cost per solved`
        : `at the same cost per solved`;
  return `${a.label} ${passPhrase}, ${costPhrase}.`;
}

function Picker({
  value,
  configs,
  onChange,
  align,
}: {
  value: string;
  configs: ConfigResult[];
  onChange: (k: string) => void;
  align: "left" | "right";
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-lg border border-[var(--line)] bg-black/60 px-3 py-2 font-mono text-[13px] text-[var(--text-2)] outline-none focus:border-[var(--line-strong)] ${
        align === "right" ? "text-right" : ""
      }`}
    >
      {configs.map((c) => (
        <option key={c.key} value={c.key}>
          {c.label}
        </option>
      ))}
    </select>
  );
}

function Column({ c, side }: { c: ConfigResult; side: "a" | "b" }) {
  const color = configColor[c.key];
  return (
    <div
      className="rounded-xl border bg-[var(--panel)] p-5"
      style={{ borderColor: `${color}55`, boxShadow: `0 0 50px -28px ${color}` }}
    >
      <div className={side === "b" ? "text-right" : ""}>
        <div className="font-mono text-[12px] uppercase tracking-[0.2em] text-[var(--text-3)]">
          config {side.toUpperCase()}
        </div>
        <div className="mt-1 font-display text-2xl font-bold text-[var(--text)]">{c.label}</div>
        <div className="mt-0.5 font-mono text-[13px] text-[var(--text-3)]">{c.model}</div>
        {c.source === "sample" && (
          <span className="mt-2 inline-block rounded bg-tester/15 px-1.5 py-0.5 font-mono text-[12px] font-semibold uppercase tracking-wide text-tester">
            sample
          </span>
        )}
      </div>
      <div className={`mt-5 ${side === "b" ? "text-right" : ""}`}>
        <div className="font-mono text-5xl font-bold tabular-nums" style={{ color }}>
          {fmtPct(c.pass_rate)}
        </div>
        <div className="mt-1 font-mono text-[12px] uppercase tracking-[0.2em] text-[var(--text-3)]">
          Pass@1
        </div>
      </div>
    </div>
  );
}

function LedgerRow({ row, a, b, mounted }: { row: Row; a: ConfigResult; b: ConfigResult; mounted: boolean }) {
  const max = Math.max(row.bar(a), row.bar(b), 1e-9);
  const aWins = row.lowerBetter ? row.a <= row.b : row.a >= row.b;
  const tie = row.a === row.b;
  const aColor = configColor[a.key];
  const bColor = configColor[b.key];
  const winDot = (win: boolean) =>
    !tie && win ? <span className="h-1.5 w-1.5 rounded-full bg-pass" /> : <span className="h-1.5 w-1.5" />;

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-2.5">
      <div className="flex items-center justify-end gap-2">
        {winDot(aWins)}
        <span className="font-mono text-sm font-semibold tabular-nums text-[var(--text)]">{row.fmt(a)}</span>
      </div>
      <div className="flex w-40 flex-col items-center sm:w-56">
        <div className="grid w-full grid-cols-2 gap-1">
          <div className="flex h-2 justify-end overflow-hidden rounded-l-full bg-black/60">
            <div className="transition-all duration-700 ease-spring" style={{ width: mounted ? `${(row.bar(a) / max) * 100}%` : "0%", background: aColor }} />
          </div>
          <div className="flex h-2 overflow-hidden rounded-r-full bg-black/60">
            <div className="transition-all duration-700 ease-spring" style={{ width: mounted ? `${(row.bar(b) / max) * 100}%` : "0%", background: bColor }} />
          </div>
        </div>
        <span className="mt-1.5 font-mono text-[11px] uppercase tracking-widest text-[var(--text-3)]">
          {row.label}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm font-semibold tabular-nums text-[var(--text)]">{row.fmt(b)}</span>
        {winDot(!aWins)}
      </div>
    </div>
  );
}

export function CompareView({ animate = true }: { animate?: boolean }) {
  const { configs, error } = useResults();
  const [aKey, setAKey] = useState("quartet");
  const [bKey, setBKey] = useState("single_large");
  const [mounted, setMounted] = useState(!animate);
  const animClass = animate ? "animate-stationIn" : "";

  useEffect(() => {
    if (animate && configs.length > 0) {
      const t = setTimeout(() => setMounted(true), 50);
      return () => clearTimeout(t);
    }
  }, [animate, configs.length]);

  // Fall back to whatever exists if the defaults are not present.
  useEffect(() => {
    if (!configs.length) return;
    if (!configs.some((c) => c.key === aKey)) setAKey(configs[0].key);
    if (!configs.some((c) => c.key === bKey)) setBKey(configs[configs.length - 1].key);
  }, [configs, aKey, bKey]);

  const a = configs.find((c) => c.key === aKey);
  const b = configs.find((c) => c.key === bKey);
  const rows = useMemo(() => (a && b ? buildRows(a, b) : []), [a, b]);

  if (error) return <div className="font-mono text-sm text-fail">{error}</div>;
  if (!a || !b) return <div className="font-mono text-sm text-[var(--text-3)]">loading results...</div>;

  const ppDelta = (a.pass_rate - b.pass_rate) * 100;
  const ratio = b.cost_per_solved ? a.cost_per_solved / b.cost_per_solved : 0;
  const tokenDelta = a.total_tokens - b.total_tokens;

  return (
    <div>
      <div className="mb-5">
        <div className="font-mono text-[13px] uppercase tracking-[0.25em] text-[var(--text-3)]">
          head to head
        </div>
        <h2 className="font-display text-3xl font-bold text-[var(--text)]">Compare configurations</h2>
        <p className="mt-1 text-sm text-[var(--text-2)]">
          Pick any two and read Pass@1, tokens, and cost side by side.
        </p>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <Picker value={aKey} configs={configs} onChange={setAKey} align="left" />
        <span className="font-display text-sm font-bold text-[var(--text-3)]">VS</span>
        <Picker value={bKey} configs={configs} onChange={setBKey} align="right" />
      </div>

      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-stretch gap-3">
        <div className={animClass} style={animate ? { animationDelay: "100ms" } : undefined}>
          <Column c={a} side="a" />
        </div>
        <div className={`flex items-center font-display text-lg font-bold text-[var(--text-3)] ${animClass}`} style={animate ? { animationDelay: "200ms" } : undefined}>vs</div>
        <div className={animClass} style={animate ? { animationDelay: "300ms" } : undefined}>
          <Column c={b} side="b" />
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-5 py-2 divide-y divide-[var(--line)]">
        {rows.map((row, i) => (
          <div key={row.key} className={animClass} style={animate ? { animationDelay: `${400 + i * 100}ms` } : undefined}>
            <LedgerRow row={row} a={a} b={b} mounted={mounted} />
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-xl border border-repairer/40 bg-repairer/[0.06] px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 font-mono">
          <Spine label="delta Pass@1" value={`${ppDelta >= 0 ? "+" : ""}${ppDelta.toFixed(1)} pts`} />
          <Spine label="cost / solved" value={ratio ? `${ratio.toFixed(2)}x` : "n/a"} />
          <Spine
            label="delta tokens"
            value={`${tokenDelta >= 0 ? "+" : ""}${fmtInt(tokenDelta)}`}
          />
        </div>
        <p className="mt-3 font-sans text-[15px] leading-snug text-[var(--text)]">{verdict(a, b)}</p>
      </div>
    </div>
  );
}

function Spine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xl font-semibold tabular-nums text-repairer">{value}</div>
      <div className="text-[12px] uppercase tracking-widest text-[var(--text-3)]">{label}</div>
    </div>
  );
}
