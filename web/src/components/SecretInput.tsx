import { useState } from "react";

// A password field with a show/hide eye toggle. Used for provider API keys and the tunnel token, so a
// user can verify what they pasted without it being readable over their shoulder by default.
export function SecretInput({
  value,
  onChange,
  placeholder,
  className = "",
  onEnter,
  autoComplete = "off",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  onEnter?: () => void;
  autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className={`relative min-w-0 ${className}`}>
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete={autoComplete}
        className="w-full rounded-md border border-[var(--line)] bg-black/60 px-2.5 py-1.5 pr-9 font-mono text-[12px] text-[var(--text)] outline-none focus:border-[var(--line-strong)]"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((s) => !s)}
        title={show ? "hide" : "show"}
        aria-label={show ? "hide value" : "show value"}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-[var(--text-3)] transition-colors hover:text-[var(--text)]"
      >
        {show ? <EyeOff /> : <Eye />}
      </button>
    </div>
  );
}

function Eye() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a13.2 13.2 0 0 1-2.3 3.06M6.6 6.6A13.2 13.2 0 0 0 2 11s3.5 7 10 7a9.1 9.1 0 0 0 4.1-.96" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m2 2 20 20" />
    </svg>
  );
}
