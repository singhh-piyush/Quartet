import { useEffect, type ReactNode } from "react";

// Right-side slide-over panel for on-demand config (Stack / Keys / Pricing). Backdrop click and ESC
// close it; the slide + backdrop fade are CSS (index.css, reduced-motion aware). Rendered only when open
// so it never sits in the layout.
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  width = "max-w-xl",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  width?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <div className="drawer-backdrop absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className={`drawer-panel panel-raised relative flex h-full w-full ${width} flex-col border-l border-[var(--line-strong)]`}>
        <div className="flex shrink-0 items-start justify-between border-b border-[var(--line)] px-5 py-4">
          <div>
            <span className="font-display text-lg font-bold tracking-tight text-[var(--text)]">{title}</span>
            {subtitle && <p className="mt-0.5 font-mono text-[11.5px] text-[var(--text-3)]">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[var(--line)] text-[var(--text-2)] transition-colors hover:border-[var(--line-strong)] hover:text-white"
          >
            &#10005;
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
