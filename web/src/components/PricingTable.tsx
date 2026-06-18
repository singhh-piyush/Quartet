import { useMemo, useState } from "react";
import type { PricingTable as Table } from "../types";

// Editable per-model price table (dollars per 1M input / output tokens). Drives the lab's cost numbers.
// Not a secret, so it persists to disk (results/lab/pricing.json) via /api/lab/pricing.
export function PricingTable({
  pricing,
  onUpdate,
}: {
  pricing: Table;
  onUpdate: (model: string, input: number, output: number) => Promise<unknown>;
}) {
  const rows = useMemo(
    () =>
      Object.entries(pricing)
        .filter(([k, v]) => k !== "_note" && v && typeof v === "object")
        .map(([model, v]) => ({ model, ...(v as { input: number; output: number }) }))
        .sort((a, b) => a.model.localeCompare(b.model)),
    [pricing],
  );

  const [newModel, setNewModel] = useState("");
  const [newIn, setNewIn] = useState("");
  const [newOut, setNewOut] = useState("");

  const addRow = () => {
    if (!newModel.trim()) return;
    onUpdate(newModel.trim(), Number(newIn) || 0, Number(newOut) || 0).then(() => {
      setNewModel("");
      setNewIn("");
      setNewOut("");
    });
  };

  return (
    <section className="space-y-2 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[12px] uppercase tracking-[0.22em] text-[var(--text-3)]">price table</span>
        <span className="font-mono text-[11px] text-[var(--text-3)]">$ per 1M tokens (in / out)</span>
      </div>
      <div className="grid grid-cols-[1fr_5.5rem_5.5rem] items-center gap-2 font-mono text-[10.5px] uppercase tracking-widest text-[var(--text-3)]">
        <span>model</span>
        <span className="text-right">input</span>
        <span className="text-right">output</span>
      </div>
      <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
        {rows.map((r) => (
          <PriceRow key={r.model} model={r.model} input={r.input} output={r.output} onUpdate={onUpdate} />
        ))}
      </div>
      <div className="grid grid-cols-[1fr_5.5rem_5.5rem_auto] items-center gap-2 border-t border-[var(--line)] pt-2">
        <input
          value={newModel}
          onChange={(e) => setNewModel(e.target.value)}
          placeholder="add model id"
          spellCheck={false}
          className="min-w-0 rounded-md border border-[var(--line)] bg-black/60 px-2 py-1.5 font-mono text-[12px] text-[var(--text)] outline-none focus:border-[var(--line-strong)]"
        />
        <NumberInput value={newIn} onChange={setNewIn} />
        <NumberInput value={newOut} onChange={setNewOut} />
        <button
          onClick={addRow}
          disabled={!newModel.trim()}
          className="rounded-md border border-[var(--line)] px-3 py-1.5 font-sans text-sm font-semibold text-[var(--text-2)] transition-colors hover:text-white disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </section>
  );
}

function PriceRow({
  model,
  input,
  output,
  onUpdate,
}: {
  model: string;
  input: number;
  output: number;
  onUpdate: (model: string, input: number, output: number) => Promise<unknown>;
}) {
  const [vin, setVin] = useState(String(input));
  const [vout, setVout] = useState(String(output));
  const dirty = Number(vin) !== input || Number(vout) !== output;
  const commit = () => {
    if (dirty) onUpdate(model, Number(vin) || 0, Number(vout) || 0);
  };
  return (
    <div className="grid grid-cols-[1fr_5.5rem_5.5rem] items-center gap-2">
      <span className="truncate font-mono text-[12px] text-[var(--text-2)]" title={model}>
        {model}
      </span>
      <NumberInput value={vin} onChange={setVin} onBlur={commit} dirty={dirty} />
      <NumberInput value={vout} onChange={setVout} onBlur={commit} dirty={dirty} />
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  onBlur,
  dirty,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  dirty?: boolean;
}) {
  return (
    <input
      value={value}
      inputMode="decimal"
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="w-full rounded-md border bg-black/60 px-2 py-1.5 text-right font-mono text-[12px] text-[var(--text)] outline-none focus:border-[var(--line-strong)]"
      style={{ borderColor: dirty ? "var(--tester)" : "var(--line)" }}
    />
  );
}
