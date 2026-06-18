import type { ProjectFile } from "../types";

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

// Flat file list (build projects are a few files). Selecting one loads its content in the viewer.
export function FileTree({
  files,
  selected,
  onSelect,
}: {
  files: ProjectFile[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  if (files.length === 0) {
    return <p className="px-2 py-1.5 font-mono text-[12px] text-[var(--text-3)]">no files yet</p>;
  }
  return (
    <ul className="space-y-0.5">
      {files.map((f) => {
        const active = f.path === selected;
        return (
          <li key={f.path}>
            <button
              onClick={() => onSelect(f.path)}
              className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left font-mono text-[12px] transition-colors ${
                active ? "bg-white/10 text-white" : "text-[var(--text-2)] hover:bg-white/5"
              }`}
            >
              <span className="truncate">{f.path}</span>
              <span className="shrink-0 text-[10.5px] text-[var(--text-3)]">{fmtSize(f.size)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
