import type { RoomState } from "../types";

// Shows the Tester's actual cases and which passed on the latest run_tests, updating across repair
// rounds. The held-out official tests stay hidden; this is the Tester's in-loop suite.
export function TestPanel({ room }: { room: RoomState }) {
  const { cases, nTotal, nFail, runs, state } = room.code;
  const nPass = Math.max(nTotal - nFail, 0);
  const tone = state === "pass" ? "var(--pass)" : state === "fail" ? "var(--fail)" : "var(--text-3)";

  return (
    <section className="flex h-full flex-col rounded-xl panel-raised">
      <header className="flex items-center justify-between border-b border-[var(--line)] px-4 py-2.5">
        <span className="font-mono text-[12px] uppercase tracking-[0.22em] text-[var(--text-3)]">tester suite</span>
        <span className="font-mono text-[12px] tabular-nums" style={{ color: tone }}>
          {nTotal > 0 ? `${nPass}/${nTotal} pass` : runs > 0 ? "ran" : "idle"}
          {runs > 0 ? ` / run ${runs}` : ""}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
        {cases.length === 0 ? (
          <p className="px-1 py-2 font-mono text-[12px] text-[var(--text-3)]">
            cases appear when the Repairer runs the Tester suite.
          </p>
        ) : (
          <ul className="space-y-1">
            {cases.map((c, i) => (
              <li
                key={i}
                className="flex items-start gap-2.5 rounded-md border border-[var(--line)] bg-black/40 px-2.5 py-1.5"
              >
                <span
                  className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: c.passed ? "var(--pass)" : "var(--fail)" }}
                />
                <div className="min-w-0">
                  <div className="break-words font-mono text-[12px] leading-snug text-[var(--text)]">{c.name}</div>
                  {!c.passed && c.error && (
                    <div className="mt-0.5 font-mono text-[11px] text-[var(--fail)]">{c.error}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
