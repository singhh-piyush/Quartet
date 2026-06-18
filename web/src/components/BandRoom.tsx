import { useEffect, useMemo, useRef } from "react";
import { roleMeta } from "../theme";
import type { RoomState, Role, Transcript, TranscriptMessage } from "../types";

const ROLES: Role[] = ["spec", "coder", "tester", "repairer", "conductor"];

function asRole(name: string): Role {
  const k = name.toLowerCase();
  return (ROLES.find((r) => r === k) ?? "conductor") as Role;
}

function clock(ts: string | null): string {
  if (!ts) return "--:--:--";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "--:--:--" : d.toISOString().slice(11, 19);
}

// Split a body into prose and fenced-code segments so code reads in mono and prose in sans.
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

function MentionChip({ text }: { text: string }) {
  const name = text.replace(/^@/, "");
  const role = ROLES.find((r) => roleMeta[r].label.toLowerCase() === name.toLowerCase());
  const color = role ? roleMeta[role].color : "#94a3b8";
  const label = role ? `@${roleMeta[role].label}` : name.length > 14 ? "@agent" : `@${name}`;
  return (
    <span className="rounded px-1.5 py-0.5 font-mono text-[11.5px] font-semibold" style={{ color, background: `${color}22` }}>
      {label}
    </span>
  );
}

function Body({ content, color }: { content: string; color: string }) {
  const parts = useMemo(() => segments(content), [content]);
  if (parts.length === 0) return null;
  return (
    <div className="mt-1.5 space-y-2">
      {parts.map((p, i) =>
        p.code ? (
          <pre
            key={i}
            className="overflow-x-auto rounded-md border border-[var(--line)] bg-black/70 p-2.5 font-mono text-[12.5px] leading-relaxed text-[var(--text)]"
            style={{ boxShadow: `inset 2px 0 0 ${color}` }}
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

function Message({ m, dim }: { m: TranscriptMessage; dim: boolean }) {
  const role = asRole(m.role);
  const meta = roleMeta[role];
  const terminal = m.kind && m.kind !== "message";
  return (
    <div
      className="flex gap-3 rounded-lg border border-transparent px-2.5 py-2 transition-opacity duration-300"
      style={{ background: `${meta.color}0c`, opacity: dim ? 0.4 : 1 }}
    >
      <div className="w-[3px] shrink-0 rounded-full" style={{ background: meta.color }} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-display text-[14px] font-semibold" style={{ color: meta.color }}>
            {meta.label}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-[var(--text-3)]">{clock(m.ts)}</span>
          {terminal && (
            <span className="rounded bg-repairer/15 px-1.5 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-repairer">
              {m.kind}
            </span>
          )}
          {m.mentions.slice(0, 2).map((x, i) => (
            <MentionChip key={i} text={x} />
          ))}
        </div>
        <Body content={m.content} color={meta.color} />
      </div>
    </div>
  );
}

function Typing({ role, preview }: { role: Role; preview: string }) {
  const meta = roleMeta[role];
  return (
    <div className="flex gap-3 rounded-lg px-2.5 py-2" style={{ background: `${meta.color}0c` }}>
      <div className="w-[3px] shrink-0 rounded-full" style={{ background: meta.color }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-display text-[14px] font-semibold" style={{ color: meta.color }}>
            {meta.label}
          </span>
          <span className="flex items-center gap-1 font-mono text-[11px] text-[var(--text-3)]">
            <span className="h-1.5 w-1.5 animate-blip rounded-full" style={{ background: meta.color }} />
            writing
          </span>
        </div>
        {preview && (
          <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-[var(--text-3)]">
            {preview}
          </p>
        )}
      </div>
    </div>
  );
}

// The Band room IS the collaboration evidence: one chat thread of the four agents talking, with
// reasoning and code inline and @mention handoffs. Merges what used to be the feed + reasoning panels.
export function BandRoom({
  transcript,
  room,
  live,
  focus,
}: {
  transcript: Transcript | null;
  room: RoomState;
  live: boolean;
  focus: Role | null;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const messages = transcript?.messages ?? [];

  // typing row: a live run, an active role, and its newest message has not landed in the transcript yet
  const activeRole = room.activeRole;
  const lastRole = messages.length > 0 ? asRole(messages[messages.length - 1].role) : null;
  const showTyping = live && !room.finished && activeRole !== null && (lastRole !== activeRole || messages.length === 0);
  const typingPreview = activeRole ? room.agents[activeRole]?.lastPreview ?? "" : "";

  // autoscroll this panel's own container (never the window) as new messages arrive
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, showTyping]);

  // when a node is focused in the rail, bring that agent's first message into view
  useEffect(() => {
    if (!focus) return;
    const el = listRef.current?.querySelector(`[data-role="${focus}"]`);
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focus]);

  const empty = messages.length === 0 && !showTyping;

  return (
    <section className="flex h-full flex-col overflow-hidden rounded-xl panel-raised">
      <header className="flex items-center justify-between border-b border-[var(--line)] px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-[15px] font-semibold text-[var(--text)]">Band room</span>
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--text-2)]">
            four agents, one thread
          </span>
        </div>
        <span className="font-mono text-[11px] tabular-nums text-[var(--text-3)]">
          {messages.length} {messages.length === 1 ? "message" : "messages"}
        </span>
      </header>

      <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {empty ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <p className="font-mono text-[12.5px] leading-relaxed text-[var(--text-3)]">
              The Band room is quiet. Start a run and the four agents talk here:
              <br />
              Spec restates, Coder writes, Tester probes, Repairer runs the suite.
            </p>
          </div>
        ) : (
          <>
            {messages.map((m, i) => (
              <div key={i} data-role={asRole(m.role)}>
                <Message m={m} dim={focus !== null && asRole(m.role) !== focus} />
              </div>
            ))}
            {showTyping && activeRole && <Typing role={activeRole} preview={typingPreview} />}
          </>
        )}
      </div>
    </section>
  );
}
