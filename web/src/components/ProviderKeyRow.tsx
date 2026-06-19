import { useEffect, useState } from "react";
import type { KeyStatus, ValidateResult } from "../types";
import { SecretInput } from "./SecretInput";

// One row per keyed provider: paste a key (with show/hide), Save, Validate, and a status chip. Shared by
// the StackBuilder provider-keys subsection and the Keys drawer, so keys are entered in exactly one place.
// The client only ever sends keys and reads back has_key/shared booleans; values never come back.
export function ProviderKeyRow({
  provider,
  label,
  status,
  onSave,
  onValidate,
}: {
  provider: string;
  label: string;
  status?: KeyStatus[string];
  onSave: (apiKey: string, baseUrl?: string) => Promise<unknown>;
  onValidate: () => Promise<ValidateResult>;
}) {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(status?.base_url ?? "");
  const [validation, setValidation] = useState<ValidateResult | null>(null);
  const [validating, setValidating] = useState(false);
  const hasKey = !!status?.has_key;
  const shared = !!status?.shared;
  const isOC = provider === "openai_compatible";

  useEffect(() => {
    if (isOC && status?.base_url) setBaseUrl(status.base_url);
  }, [isOC, status?.base_url]);

  const hasTyped = () => !!apiKey.trim() || (isOC && !!baseUrl.trim());

  const save = async () => {
    if (!hasTyped()) return;
    await onSave(apiKey.trim(), isOC ? baseUrl.trim() : undefined);
    setApiKey("");
  };
  // Validate is self-contained: if there is a freshly typed key/base_url, store it FIRST (awaited) so
  // the backend has it, then check. Otherwise validating a just-typed key races the save and the server
  // reports "no key/base_url set for this provider".
  const validate = async () => {
    setValidating(true);
    try {
      if (hasTyped()) {
        await onSave(apiKey.trim(), isOC ? baseUrl.trim() : undefined);
        setApiKey("");
      }
      setValidation(await onValidate());
    } finally {
      setValidating(false);
    }
  };

  // Distinguish a BYO/env key (green) from the server's rate-limited shared default (amber).
  const chip = hasKey
    ? shared
      ? { label: "shared key", color: "var(--tester)", bg: "rgba(251,191,36,0.12)" }
      : { label: "key set", color: "var(--pass)", bg: "rgba(52,211,153,0.12)" }
    : { label: "no key", color: "var(--text-3)", bg: "rgba(255,255,255,0.06)" };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-24 shrink-0 font-mono text-[11px] text-[var(--text-2)]">{label}</span>
        {isOC && (
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://host/v1"
            spellCheck={false}
            className="w-52 rounded-md border border-[var(--line)] bg-black/60 px-2.5 py-1.5 font-mono text-[12px] text-[var(--text)] outline-none focus:border-[var(--line-strong)]"
          />
        )}
        <SecretInput
          value={apiKey}
          onChange={setApiKey}
          onEnter={save}
          placeholder={hasKey ? "key stored (enter to replace)" : "paste api key"}
          className="flex-1"
        />
        <button
          onClick={save}
          className="rounded-md border border-[var(--line)] px-3 py-1.5 font-sans text-sm font-semibold text-[var(--text-2)] transition-colors hover:text-white"
        >
          Save
        </button>
        <button
          onClick={validate}
          disabled={validating}
          className="rounded-md border border-[var(--line)] px-3 py-1.5 font-sans text-sm font-semibold text-[var(--text-2)] transition-colors hover:text-white disabled:opacity-40"
        >
          {validating ? "checking..." : "Validate"}
        </button>
        <span className="rounded-full px-2 py-0.5 font-mono text-[10.5px]" style={{ background: chip.bg, color: chip.color }}>
          {chip.label}
        </span>
      </div>
      {validation && (
        <div
          className="rounded-md px-3 py-1.5 font-mono text-[11.5px]"
          style={{
            background: validation.ok ? "rgba(52,211,153,0.1)" : "rgba(248,113,113,0.1)",
            color: validation.ok ? "var(--pass)" : "var(--fail)",
          }}
        >
          {validation.ok ? "ok: " : "failed: "}
          {validation.detail}
        </div>
      )}
    </div>
  );
}
