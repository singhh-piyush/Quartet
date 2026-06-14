import { useEffect, useRef } from "react";
import type { FeedItem, Role } from "../types";
import { roleMeta } from "../theme";

const ROLES: Role[] = ["spec", "coder", "tester", "repairer", "conductor"];

function clock(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "--:--:--" : d.toISOString().slice(11, 19);
}

function Chip({ text }: { text: string }) {
  const name = text.replace(/^@/, "");
  const role = ROLES.find((r) => roleMeta[r].label.toLowerCase() === name.toLowerCase());
  const color = role ? roleMeta[role].color : "#94a3b8";
  const label = role ? `@${roleMeta[role].label}` : name.length > 14 ? "@agent" : `@${name}`;
  return (
    <span
      className="rounded px-1.5 py-0.5 font-mono text-[12px] font-semibold"
      style={{ color, background: `${color}1f` }}
    >
      {label}
    </span>
  );
}

export function HandoffFeed({ feed }: { feed: FeedItem[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [feed.length]);

  return (
    <div className="flex h-full flex-col rounded-xl border border-[var(--line)] bg-[var(--panel)]">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-2.5">
        <span className="font-display text-[15px] font-semibold text-[var(--text)]">Band room</span>
        <span className="font-mono text-[12px] uppercase tracking-widest text-[var(--text-3)]">
          message handoffs
        </span>
      </div>
      <div className="flex-1 space-y-1.5 overflow-y-auto px-3 py-3">
        {feed.length === 0 && (
          <div className="pt-8 text-center font-mono text-[13px] text-[var(--text-3)]">
            awaiting first message...
          </div>
        )}
        {feed.map((item) => {
          const meta = roleMeta[item.role];
          const posted = item.kind === "posted";
          return (
            <div
              key={item.id}
              className="animate-riseIn flex gap-2.5 rounded-lg border border-transparent px-2.5 py-2 transition-all duration-300 ease-spring hover:border-[var(--line)]"
              style={{ background: posted ? `${meta.color}0d` : "rgba(255,255,255,0.015)" }}
            >
              <div className="w-0.5 shrink-0 rounded-full" style={{ background: meta.color }} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-mono text-[12px] tabular-nums text-[var(--text-3)]">
                    {clock(item.ts)}
                  </span>
                  <span
                    className="font-mono text-[13px] font-semibold uppercase tracking-wider"
                    style={{ color: meta.color }}
                  >
                    {meta.label}
                  </span>
                  <span className="text-[13px] text-[var(--text-3)]">
                    {posted ? "posted" : `received from ${item.from}`}
                  </span>
                  {item.mentions.slice(0, 2).map((m, i) => (
                    <Chip key={i} text={m} />
                  ))}
                </div>
                <div className="mt-1 line-clamp-2 text-[14px] leading-snug text-[var(--text-2)]">
                  {item.preview}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </div>
  );
}
