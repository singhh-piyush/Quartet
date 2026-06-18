import { useEffect, useState } from "react";
import { roleMeta } from "../theme";
import { PROVIDERS } from "../types";
import type { ModelConfig, RunStatus } from "../types";

const ROLES = ["spec", "coder", "tester", "repairer"] as const;
const SUGGESTIONS = [
  "Qwen/Qwen2.5-Coder-7B-Instruct",
  "Qwen/Qwen2.5-Coder-32B-Instruct",
  "Qwen/Qwen2.5-7B-Instruct-Turbo",
  "meta-llama/Llama-3.1-8B-Instruct",
  "local-model",
];

function Row({
  label,
  color,
  model,
  provider,
  online,
  onModel,
  onProvider,
}: {
  label: string;
  color: string;
  model: string;
  provider: string;
  online?: boolean | null;
  onModel: (m: string) => void;
  onProvider?: (p: string) => void;
}) {
  const [v, setV] = useState(model);
  useEffect(() => setV(model), [model]);
  const commit = () => {
    if (v.trim() && v.trim() !== model) onModel(v.trim());
  };
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex w-24 shrink-0 items-center gap-1.5">
        {online !== undefined && (
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: online ? "var(--pass)" : "rgba(255,255,255,0.18)" }}
            title={online ? "process online" : "offline"}
          />
        )}
        <span className="font-display text-sm font-semibold" style={{ color }}>
          {label}
        </span>
      </div>
      <input
        value={v}
        list="model-suggestions"
        spellCheck={false}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-black/60 px-2.5 py-1.5 font-mono text-[12.5px] text-[var(--text)] outline-none focus:border-[var(--line-strong)]"
      />
      {onProvider && (
        <select
          value={provider}
          onChange={(e) => onProvider(e.target.value)}
          className="shrink-0 rounded-md border border-[var(--line)] bg-black/60 px-2 py-1.5 font-mono text-[12px] text-[var(--text-2)] outline-none focus:border-[var(--line-strong)]"
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function ModelDashboard({
  models,
  status,
  saving,
  onSlot,
  onProvider,
}: {
  models: ModelConfig | null;
  status: RunStatus;
  saving: boolean;
  onSlot: (target: string, model: string) => void;
  onProvider: (target: string, provider: string) => void;
}) {
  const onlineByRole: Record<string, boolean> = {};
  for (const a of status.agents) onlineByRole[a.role] = a.alive;

  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
      <datalist id="model-suggestions">
        {SUGGESTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[12px] uppercase tracking-[0.22em] text-[var(--text-3)]">models</span>
        <span className="font-mono text-[11px] text-[var(--text-3)]">
          {saving ? "saving..." : "bind on next run"}
        </span>
      </div>

      {!models ? (
        <p className="font-mono text-[12px] text-[var(--text-3)]">loading model config...</p>
      ) : (
        <div className="space-y-2">
          {ROLES.map((r) => (
            <Row
              key={r}
              label={roleMeta[r].label}
              color={roleMeta[r].color}
              model={models.agents[r]?.model ?? ""}
              provider={models.agents[r]?.provider ?? "local"}
              online={onlineByRole[r] ?? null}
              onModel={(m) => onSlot(r, m)}
              onProvider={(p) => onProvider(r, p)}
            />
          ))}
          <div className="my-1 h-px bg-[var(--line)]" />
          <Row
            label="Large"
            color={roleMeta.coder.color}
            model={models.large?.model ?? ""}
            provider={models.large?.provider ?? "local"}
            onModel={(m) => onSlot("large", m)}
            onProvider={(p) => onProvider("large", p)}
          />
        </div>
      )}
    </section>
  );
}
