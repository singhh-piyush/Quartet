import { useEffect, useMemo, useState } from "react";
import { roleMeta } from "../theme";
import { KEYED_PROVIDERS, PROVIDERS } from "../types";
import type { ModelConfig, ModelSlot, RunStatus } from "../types";
import { useStacks } from "../useStacks";
import { ModelDashboard } from "./ModelDashboard";
import { ProviderKeyRow } from "./ProviderKeyRow";

const ROLES = ["spec", "coder", "tester", "repairer"] as const;

// Curated seeds shown in the dropdowns before a provider's live /models list is fetched (or when a
// provider has no listable endpoint). The live list, once loaded, takes over.
const SEED_MODELS: Record<string, string[]> = {
  local: ["local-model"],
  groq: ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
  aimlapi: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-5", "claude-sonnet-4-6", "claude-opus-4-8"],
  gemini: ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
  openrouter: [
    "openai/gpt-oss-20b",
    "openai/gpt-oss-120b",
    "meta-llama/llama-3.3-70b-instruct",
    "google/gemini-2.5-flash",
    "anthropic/claude-sonnet-4",
    "deepseek/deepseek-chat",
  ],
  openai_compatible: [],
};

// Sensible per-role model when you apply a provider to the whole stack (cheap small for spec/tester,
// stronger for coder/repairer; the large lane gets the heaviest). Falls back to the current model.
const ROLE_DEFAULTS: Record<string, Record<string, string>> = {
  groq: {
    spec: "openai/gpt-oss-20b",
    coder: "openai/gpt-oss-120b",
    tester: "llama-3.3-70b-versatile",
    repairer: "openai/gpt-oss-120b",
    large: "openai/gpt-oss-120b",
  },
  aimlapi: {
    spec: "gpt-4o-mini",
    coder: "gpt-4o",
    tester: "gpt-4o-mini",
    repairer: "gpt-4o",
    large: "claude-opus-4-8",
  },
  gemini: {
    spec: "gemini-2.5-flash-lite",
    coder: "gemini-2.5-flash",
    tester: "gemini-2.5-flash-lite",
    repairer: "gemini-2.5-flash",
    large: "gemini-2.5-pro",
  },
  openrouter: {
    spec: "openai/gpt-oss-20b",
    coder: "openai/gpt-oss-120b",
    tester: "meta-llama/llama-3.3-70b-instruct",
    repairer: "openai/gpt-oss-120b",
    large: "anthropic/claude-sonnet-4",
  },
};

const providerLabel: Record<string, string> = {
  local: "Local",
  groq: "Groq",
  aimlapi: "AI/ML API",
  gemini: "Gemini",
  openrouter: "OpenRouter",
  openai_compatible: "OpenAI-compatible",
};

export function StackBuilder({
  models,
  saving,
  status,
  onUpdate,
  onPatchMany,
  onReloadModels,
}: {
  models: ModelConfig | null;
  saving: boolean;
  status: RunStatus;
  onUpdate: (target: string, patch: Partial<ModelSlot>) => void;
  onPatchMany: (patch: Partial<ModelConfig>) => void;
  onReloadModels: () => void;
}) {
  const sx = useStacks();
  const [provider, setProvider] = useState<string>("groq");
  const [selected, setSelected] = useState("");
  const [saveName, setSaveName] = useState("");
  const [advanced, setAdvanced] = useState(false);

  const needsKey = (KEYED_PROVIDERS as readonly string[]).includes(provider);

  // Providers currently referenced by the stack, plus the one being configured, so their model lists
  // are ready for the dropdowns and every key they need has a field.
  const usedProviders = useMemo(() => {
    const set = new Set<string>([provider]);
    if (models) {
      for (const r of ROLES) set.add(models.agents[r]?.provider ?? "local");
      set.add(models.large?.provider ?? "local");
    }
    return [...set];
  }, [models, provider]);

  // Every keyed provider in play, so the advanced per-role mixing always has a place to enter its key.
  const keyedUsed = usedProviders.filter((p) => (KEYED_PROVIDERS as readonly string[]).includes(p));

  useEffect(() => {
    for (const p of usedProviders) sx.loadProviderModels(p);
    // sx.loadProviderModels is stable enough for this lazy prime; avoid re-running on its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usedProviders.join(",")]);

  const optionsFor = (p: string): string[] => {
    const live = sx.providerModels[p]?.models ?? [];
    return live.length ? live : SEED_MODELS[p] ?? [];
  };

  const applyToAll = () => {
    const seeds = ROLE_DEFAULTS[provider] ?? {};
    const patch: Partial<ModelConfig> = {
      agents: Object.fromEntries(
        ROLES.map((r) => [r, { provider, model: seeds[r] ?? models?.agents[r]?.model ?? "" }]),
      ),
      large: { provider, model: seeds.large ?? models?.large?.model ?? "" },
    };
    onPatchMany(patch);
  };

  const onLoad = () => {
    if (!selected) return;
    sx.load(selected).then(() => onReloadModels());
  };

  const onDuplicate = () => {
    const src = selected || models?.name;
    if (!src) return;
    sx.duplicate(src, `${src}-copy`).then(() => sx.refreshStacks());
  };

  const onSaveAs = () => {
    if (!saveName.trim() || !models) return;
    sx.saveAs(saveName.trim(), models).then((saved) => {
      if (saved) {
        setSaveName("");
        setSelected(saved.name ?? "");
      }
    });
  };

  return (
    <section className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[12px] uppercase tracking-[0.22em] text-[var(--text-3)]">build your stack</span>
        <span className="font-mono text-[11px] text-[var(--text-3)]">
          {saving || sx.busy ? "saving..." : `active: ${models?.name ?? "default"}`}
        </span>
      </div>

      {/* Saved stacks: load / duplicate */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] uppercase tracking-widest text-[var(--text-3)]">stacks</span>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="min-w-[10rem] rounded-md border border-[var(--line)] bg-black/60 px-2 py-1.5 font-mono text-[12px] text-[var(--text)] outline-none focus:border-[var(--line-strong)]"
        >
          <option value="">select a saved stack...</option>
          {sx.stacks.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name} ({s.providers.join("+")})
            </option>
          ))}
        </select>
        <button
          onClick={onLoad}
          disabled={!selected}
          className="rounded-md border border-[var(--line)] px-3 py-1.5 font-sans text-sm font-semibold text-[var(--text-2)] transition-colors hover:text-white disabled:opacity-40"
        >
          Load
        </button>
        <button
          onClick={onDuplicate}
          disabled={!selected && !models?.name}
          className="rounded-md border border-[var(--line)] px-3 py-1.5 font-sans text-sm font-semibold text-[var(--text-2)] transition-colors hover:text-white disabled:opacity-40"
        >
          Duplicate
        </button>
      </div>

      <div className="h-px bg-[var(--line)]" />

      {/* Provider quick-apply + a key field for every keyed provider the stack uses */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-20 shrink-0 font-mono text-[11px] uppercase tracking-widest text-[var(--text-3)]">provider</span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="rounded-md border border-[var(--line)] bg-black/60 px-2 py-1.5 font-mono text-[12px] text-[var(--text)] outline-none focus:border-[var(--line-strong)]"
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {providerLabel[p] ?? p}
              </option>
            ))}
          </select>
          <button
            onClick={applyToAll}
            className="rounded-md border border-[var(--line)] px-3 py-1.5 font-sans text-sm font-semibold text-[var(--text-2)] transition-colors hover:text-white"
          >
            Use for all roles
          </button>
          {needsKey && !keyedUsed.includes(provider) && (
            <span className="ml-auto font-mono text-[10.5px] text-[var(--text-3)]">
              add {providerLabel[provider] ?? provider} below to enter its key
            </span>
          )}
        </div>

        {keyedUsed.length > 0 && (
          <div className="space-y-2 rounded-lg border border-[var(--line)] bg-black/30 p-2.5">
            <span className="font-mono text-[10.5px] uppercase tracking-widest text-[var(--text-3)]">provider keys</span>
            {keyedUsed.map((p) => (
              <ProviderKeyRow
                key={p}
                provider={p}
                label={providerLabel[p] ?? p}
                status={sx.keys[p]}
                onSave={(apiKey, baseUrl) => sx.saveProviderKey(p, apiKey, baseUrl)}
                onValidate={() => sx.validate(p)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="h-px bg-[var(--line)]" />

      {/* Per-role model dropdowns (4 agents + large) */}
      {models && (
        <div className="space-y-2">
          <datalist id="stack-model-options">
            {[...new Set([...optionsFor(provider), ...usedProviders.flatMap((p) => optionsFor(p))])].map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          {ROLES.map((r) => (
            <ModelRow
              key={r}
              label={roleMeta[r].label}
              color={roleMeta[r].color}
              provider={models.agents[r]?.provider ?? "local"}
              model={models.agents[r]?.model ?? ""}
              options={optionsFor(models.agents[r]?.provider ?? "local")}
              onModel={(m) => onUpdate(r, { model: m })}
            />
          ))}
          <ModelRow
            label="Large"
            color={roleMeta.coder.color}
            provider={models.large?.provider ?? "local"}
            model={models.large?.model ?? ""}
            options={optionsFor(models.large?.provider ?? "local")}
            onModel={(m) => onUpdate("large", { model: m })}
          />
        </div>
      )}

      {/* Save As */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          placeholder="new stack name"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-black/60 px-2.5 py-1.5 font-mono text-[12px] text-[var(--text)] outline-none focus:border-[var(--line-strong)]"
        />
        <button
          onClick={onSaveAs}
          disabled={!saveName.trim() || !models}
          className="rounded-md bg-spec/20 px-4 py-1.5 font-sans text-sm font-semibold text-spec transition-colors hover:bg-spec/30 disabled:opacity-40"
        >
          Save as
        </button>
      </div>

      {/* Advanced: per-role provider mixing (the original free-text dashboard) */}
      <button
        onClick={() => setAdvanced((a) => !a)}
        className="font-mono text-[11px] uppercase tracking-widest text-[var(--text-3)] underline-offset-4 hover:text-[var(--text-2)] hover:underline"
      >
        {advanced ? "hide advanced" : "advanced: per-role provider"}
      </button>
      {advanced && (
        <ModelDashboard
          models={models}
          status={status}
          saving={saving}
          keys={sx.keys}
          onSlot={(t, m) => onUpdate(t, { model: m })}
          onProvider={(t, p) => onUpdate(t, { provider: p })}
        />
      )}
    </section>
  );
}

function ModelRow({
  label,
  color,
  provider,
  model,
  options,
  onModel,
}: {
  label: string;
  color: string;
  provider: string;
  model: string;
  options: string[];
  onModel: (m: string) => void;
}) {
  const [v, setV] = useState(model);
  useEffect(() => setV(model), [model]);
  const commit = () => {
    if (v.trim() && v.trim() !== model) onModel(v.trim());
  };
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-20 shrink-0 font-display text-sm font-semibold" style={{ color }}>
        {label}
      </span>
      <span className="w-16 shrink-0 font-mono text-[10.5px] uppercase tracking-wider text-[var(--text-3)]">{provider}</span>
      <input
        value={v}
        list="stack-model-options"
        spellCheck={false}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-black/60 px-2.5 py-1.5 font-mono text-[12.5px] text-[var(--text)] outline-none focus:border-[var(--line-strong)]"
        placeholder={options[0] ?? "model id"}
      />
    </div>
  );
}
