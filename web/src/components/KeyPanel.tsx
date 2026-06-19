import { useState } from "react";
import { getApiToken, setApiToken } from "../api";
import { KEYED_PROVIDERS } from "../types";
import { useStacks } from "../useStacks";
import { ProviderKeyRow } from "./ProviderKeyRow";
import { SecretInput } from "./SecretInput";

const LABEL: Record<string, string> = {
  groq: "Groq",
  aimlapi: "AI/ML API",
  gemini: "Gemini",
  openrouter: "OpenRouter",
  openai_compatible: "OpenAI-compatible",
};

// The Keys drawer: enter a provider key for the session. Sent over HTTPS to the demo server, kept in
// memory only (never disk, never logged, never returned). When a shared Groq key is configured on the
// server, a banner tells the user they can run immediately and add their own key to upgrade.
export function KeyPanel() {
  const sx = useStacks();
  const sharedGroq = !!(sx.keys.groq?.shared && sx.keys.groq?.has_key);
  const [token, setToken] = useState(getApiToken());

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[var(--line)] bg-black/30 p-3">
        <p className="font-sans text-[13px] leading-relaxed text-[var(--text-2)]">
          Keys are sent over HTTPS to the demo server and used for this session only. They are never
          written to disk, never logged, and never sent back to this page.
        </p>
      </div>

      {sharedGroq && (
        <div className="rounded-lg border border-tester/40 bg-tester/10 p-3">
          <p className="font-sans text-[13px] leading-relaxed text-tester">
            A shared Groq key is available, so you can run right now with no key of your own. Shared runs
            are rate-limited. Add your own Groq key below to use your own quota.
          </p>
        </div>
      )}

      <div className="space-y-2.5">
        {KEYED_PROVIDERS.map((p) => (
          <div key={p} className="rounded-lg border border-[var(--line)] bg-[var(--panel-2)] p-3">
            <ProviderKeyRow
              provider={p}
              label={LABEL[p] ?? p}
              status={sx.keys[p]}
              onSave={(k, b) => sx.saveProviderKey(p, k, b)}
              onValidate={() => sx.validate(p)}
            />
          </div>
        ))}
      </div>

      {sx.error && <p className="font-mono text-[12px] text-fail">{sx.error}</p>}

      <div className="space-y-2 rounded-lg border border-[var(--line)] bg-[var(--panel-2)] p-3">
        <span className="font-mono text-[10.5px] uppercase tracking-widest text-[var(--text-3)]">access token</span>
        <p className="font-sans text-[12.5px] leading-relaxed text-[var(--text-3)]">
          Only needed when this page drives a remote demo server over a tunnel. Matches the server's
          QUARTET_API_TOKEN. Left empty for local use.
        </p>
        <SecretInput
          value={token}
          onChange={(v) => {
            setToken(v);
            setApiToken(v);
          }}
          placeholder="tunnel access token"
        />
      </div>
    </div>
  );
}
