import type { RoomState } from "../types";

const FRAME = {
  idle: { border: "var(--line)", led: "#52525b", glow: "none", label: "no tests run", tone: "var(--text-3)" },
  fail: { border: "#f43f5e", led: "#f43f5e", glow: "0 0 44px -14px #f43f5e", label: "TESTS FAILED", tone: "#fda4af" },
  pass: { border: "#34d399", led: "#34d399", glow: "0 0 44px -14px #34d399", label: "TESTS PASSED", tone: "#6ee7b7" },
} as const;

// Pull a ```python ... ``` block out of the Coder/Repairer preview if present, else show the preview.
function extractCode(preview: string): string {
  const m = preview.match(/```(?:python)?\s*([\s\S]*?)```/);
  return (m ? m[1] : preview).trim();
}

export function CodePanel({ code, runs }: { code: RoomState["code"]; runs: number }) {
  const f = FRAME[code.state];
  const body = code.preview ? extractCode(code.preview) : "";
  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-xl border bg-black/60 transition-all duration-500 ease-spring"
      style={{ borderColor: f.border, boxShadow: f.glow }}
    >
      <div
        className="flex items-center justify-between border-b px-4 py-2.5"
        style={{ borderColor: `color-mix(in srgb, ${f.border} 45%, transparent)` }}
      >
        <span className="font-display text-[15px] font-semibold text-[var(--text)]">candidate solution</span>
        <span className="flex items-center gap-2 font-mono text-[13px] font-semibold" style={{ color: f.tone }}>
          <span
            className={`h-2 w-2 rounded-full ${code.state !== "idle" ? "animate-glow" : ""}`}
            style={{ background: f.led }}
          />
          {f.label}
          {runs > 0 && <span className="text-[var(--text-3)]">/ run_tests x{runs}</span>}
        </span>
      </div>
      <pre className="flex-1 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words px-4 py-3 font-mono text-[14px] leading-relaxed text-[var(--text)]">
        <code>{body || "// the Coder implementation appears here as it is handed off"}</code>
      </pre>
    </div>
  );
}
