import { Fragment, useMemo } from "react";
import { roleMeta } from "../theme";
import type { RoomState, Role, Transcript } from "../types";

// Split a message body into prose and fenced code segments so code reads in mono and prose in sans.
function segments(content: string): { code: boolean; text: string }[] {
  const out: { code: boolean; text: string }[] = [];
  const re = /```[a-zA-Z]*\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) out.push({ code: false, text: content.slice(last, m.index).trim() });
    out.push({ code: true, text: m[1].replace(/\n$/, "") });
    last = re.lastIndex;
  }
  if (last < content.length) out.push({ code: false, text: content.slice(last).trim() });
  return out.filter((s) => s.text.length > 0);
}

function Body({ content, color }: { content: string; color: string }) {
  const parts = useMemo(() => segments(content), [content]);
  return (
    <div className="space-y-2.5">
      {parts.map((p, i) =>
        p.code ? (
          <pre
            key={i}
            className="overflow-x-auto rounded-md border border-[var(--line)] bg-black/60 p-3 font-mono text-[12.5px] leading-relaxed text-[var(--text)]"
            style={{ boxShadow: `inset 2px 0 0 ${color}66` }}
          >
            {p.text}
          </pre>
        ) : (
          <p key={i} className="whitespace-pre-wrap font-sans text-[13.5px] leading-relaxed text-[var(--text-2)]">
            {p.text}
          </p>
        ),
      )}
    </div>
  );
}

export function ReasoningPanel({
  transcript,
  room,
  selected,
}: {
  transcript: Transcript | null;
  room: RoomState;
  selected: Role;
}) {
  const meta = roleMeta[selected];
  const messages = useMemo(
    () => (transcript?.messages ?? []).filter((mm) => mm.role === selected),
    [transcript, selected],
  );
  const livePreview = room.agents[selected]?.lastPreview ?? "";

  return (
    <section className="flex h-full flex-col rounded-xl border border-[var(--line)] bg-[var(--panel)]">
      <header className="flex items-center justify-between border-b border-[var(--line)] px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[12px] uppercase tracking-[0.22em] text-[var(--text-3)]">reasoning</span>
          <span className="font-display text-base font-semibold" style={{ color: meta.color }}>
            {meta.label}
          </span>
        </div>
        <span className="font-mono text-[11px] text-[var(--text-3)]">{meta.sub}</span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
        {messages.length > 0 ? (
          <div className="space-y-5">
            {messages.map((mm, i) => (
              <Fragment key={i}>
                {messages.length > 1 && (
                  <div className="font-mono text-[11px] uppercase tracking-widest text-[var(--text-3)]">
                    turn {i + 1}
                    {mm.kind ? ` / ${mm.kind.toLowerCase()}` : ""}
                  </div>
                )}
                <Body content={mm.content} color={meta.color} />
              </Fragment>
            ))}
          </div>
        ) : livePreview ? (
          <div className="space-y-2">
            <div className="font-mono text-[11px] uppercase tracking-widest text-[var(--text-3)]">live preview</div>
            <p className="whitespace-pre-wrap font-sans text-[13.5px] leading-relaxed text-[var(--text-2)]">{livePreview}</p>
            <p className="pt-1 font-mono text-[11px] text-[var(--text-3)]">
              full reasoning loads when the run completes
            </p>
          </div>
        ) : (
          <p className="font-mono text-[12px] text-[var(--text-3)]">
            {meta.label} has not spoken yet. Its reasoning appears here as control reaches it.
          </p>
        )}
      </div>
    </section>
  );
}
