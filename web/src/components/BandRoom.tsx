import { useEffect, useMemo, useRef } from "react";
import { roleMeta } from "../theme";
import type { RoomState, Role, Transcript, TranscriptMessage } from "../types";
import { useTypewriter } from "../hooks/useTypewriter";

const ROLES: Role[] = ["spec", "coder", "tester", "repairer", "conductor"];

function asRole(name: string): Role {
  const k = name.toLowerCase();
  return (ROLES.find((r) => r === k) ?? "conductor") as Role;
}

// The Build chat adds two non-agent speakers: the human ("user") and the conversational driver
// ("orchestrator"). They are not Band agents, so they live outside the Role union; resolve their
// label/color at runtime here. Everything else maps to an agent via asRole.
function speakerMeta(roleStr: string): { label: string; color: string; isUser: boolean } {
  const k = (roleStr || "").toLowerCase();
  if (k === "user") return { label: "You", color: "var(--text)", isUser: true };
  if (k === "orchestrator") return { label: "Orchestrator", color: roleMeta.conductor.color, isUser: false };
  const r = asRole(roleStr);
  return { label: roleMeta[r].label, color: roleMeta[r].color, isUser: false };
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

function MentionChip({ text, isUser }: { text: string; isUser?: boolean }) {
  const name = text.replace(/^@/, "");
  const role = ROLES.find((r) => roleMeta[r].label.toLowerCase() === name.toLowerCase());
  const color = role ? roleMeta[role].color : "#94a3b8";
  const label = role ? `@${roleMeta[role].label}` : name.length > 14 ? "@agent" : `@${name}`;
  return (
    <span className="rounded px-1.5 py-0.5 font-mono text-[11.5px] font-semibold" style={{ color: isUser ? "rgba(0,0,0,0.8)" : color, background: isUser ? "rgba(0,0,0,0.1)" : `${color}22` }}>
      {label}
    </span>
  );
}




// Blinking cursor shown at the end of a message that is still being typed.
function Cursor({ color }: { color: string }) {
  return (
    <span
      className="inline-block w-[2px] h-[1.1em] rounded-sm align-middle ml-0.5 animate-blip"
      style={{ background: color, verticalAlign: "text-bottom" }}
    />
  );
}

function Message({
  m,
  dim,
  revealed,
  animate,
}: {
  m: TranscriptMessage;
  dim: boolean;
  revealed: number;
  animate: boolean;
}) {
  const meta = speakerMeta(m.role);
  const terminal = m.kind && m.kind !== "message";
  const isUser = meta.isUser;

  // Slice the content to only reveal what the typewriter has reached.
  const visibleContent = animate ? m.content.slice(0, revealed) : m.content;
  const isTyping = animate && revealed < m.content.length;

  return (
    <div className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] flex flex-col transition-opacity duration-300 ${
          isUser ? "rounded-2xl rounded-br-sm text-black px-3.5 py-2" : "rounded-2xl rounded-bl-sm gap-1 px-4 py-3"
        }`}
        style={{
          background: isUser ? "var(--accent)" : `${meta.color}15`,
          border: isUser ? "none" : `1px solid ${meta.color}30`,
          opacity: dim ? 0.4 : 1,
        }}
      >
        {!isUser && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 justify-start">
            <span className="font-display text-[13px] font-semibold" style={{ color: meta.color }}>
              {meta.label}
            </span>
            <span className="font-mono text-[10px] tabular-nums text-[var(--text-3)]">{clock(m.ts)}</span>
            {terminal && (
              <span className="rounded bg-[var(--accent)]/30 px-1.5 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-black">
                {m.kind}
              </span>
            )}
            {m.mentions.slice(0, 2).map((x, i) => (
              <MentionChip key={i} text={x} isUser={false} />
            ))}
          </div>
        )}
        {/* Render the visible content — the typewriter slices it, then appends a blinking cursor
            while still animating */}
        {visibleContent.length > 0 && (
          <div className="mt-1.5 space-y-2">
            {segments(visibleContent).map((p, i, arr) =>
              p.code ? (
                <pre
                  key={i}
                  className="overflow-x-auto rounded-md border border-[var(--line)] bg-black/70 p-2.5 font-mono text-[12.5px] leading-relaxed text-[var(--text)]"
                  style={{ boxShadow: `inset 2px 0 0 ${meta.color}` }}
                >
                  {p.text}
                  {isTyping && i === arr.length - 1 && <Cursor color={meta.color} />}
                </pre>
              ) : (
                <p
                  key={i}
                  className={`whitespace-pre-wrap font-sans text-[13.5px] leading-relaxed ${
                    isUser ? "text-black/90" : "text-[var(--text-2)]"
                  }`}
                >
                  {p.text}
                  {isTyping && i === arr.length - 1 && <Cursor color={isUser ? "rgba(0,0,0,0.6)" : meta.color} />}
                </p>
              ),
            )}
          </div>
        )}
        {/* Show the cursor even before first character arrives */}
        {visibleContent.length === 0 && isTyping && (
          <div className="mt-1.5">
            <p className="whitespace-pre-wrap font-sans text-[13.5px] leading-relaxed text-[var(--text-2)]">
              <Cursor color={meta.color} />
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Typing({ role, preview }: { role: Role; preview: string }) {
  const meta = roleMeta[role];
  return (
    <div className="flex w-full justify-start">
      <div
        className="max-w-[85%] flex flex-col gap-1 rounded-2xl rounded-bl-sm px-4 py-3"
        style={{ background: `${meta.color}15`, border: `1px solid ${meta.color}30` }}
      >
        <div className="flex items-center gap-2">
          <span className="font-display text-[13px] font-semibold" style={{ color: meta.color }}>
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
  embedded = false,
  filterType = "all",
  sending = false,
  // animate: when true, new messages are typed in character-by-character.
  // Only agents-only panels (the Output section) animate; the user/orchestrator chat does not.
  animate = false,
}: {
  transcript: Transcript | null;
  room: RoomState;
  live: boolean;
  focus: Role | null;
  // embedded: drop the panel chrome + own header so a parent (the Build chat workspace) can supply its
  // own header and dock a composer below, presenting the thread as one cohesive chat window.
  embedded?: boolean;
  filterType?: "all" | "user-only" | "agents-only";
  // sending: show a "Orchestrator is thinking" indicator while waiting for the API response
  sending?: boolean;
  animate?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const allMessages = transcript?.messages ?? [];
  const messages = useMemo(() => {
    if (filterType === "all") return allMessages;
    if (filterType === "user-only") {
      return allMessages.filter((m) => {
        const k = (m.role || "").toLowerCase();
        return k === "user" || k === "orchestrator";
      });
    }
    return allMessages.filter((m) => {
      const k = (m.role || "").toLowerCase();
      return k !== "user" && k !== "orchestrator";
    });
  }, [allMessages, filterType]);

  // typing row: a live run, an active role, and its newest message has not landed in the transcript yet
  const activeRole = room.activeRole;
  const lastRole = messages.length > 0 ? asRole(messages[messages.length - 1].role) : null;
  const showTyping = filterType !== "user-only" && live && !room.finished && activeRole !== null && (lastRole !== activeRole || messages.length === 0);
  const typingPreview = activeRole ? room.agents[activeRole]?.streamPreview || room.agents[activeRole]?.lastPreview || "" : "";

  // Build a stable key + content list for the typewriter. We use (role + index) as the key so
  // re-polled transcripts with identical content don't re-animate.
  const typewriterItems = useMemo(
    () =>
      animate
        ? messages.map((m, i) => ({
            key: `${m.role}-${i}-${m.ts ?? i}`,
            content: m.content,
          }))
        : [],
    [messages, animate],
  );

  const typewriterMap = useTypewriter(typewriterItems);

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

  const empty = messages.length === 0 && !showTyping && !sending;

  return (
    <section className={`flex h-full flex-col overflow-hidden ${embedded ? "" : "rounded-xl panel-raised"}`}>
      {!embedded && (
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
      )}

      <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4">
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
            {messages.map((m, i) => {
              const key = `${m.role}-${i}-${m.ts ?? i}`;
              const tw = animate ? typewriterMap.get(key) : undefined;
              return (
                <div key={i} data-role={asRole(m.role)}>
                  <Message
                    m={m}
                    dim={focus !== null && asRole(m.role) !== focus}
                    revealed={tw ? tw.revealed : m.content.length}
                    animate={animate && !!(tw && !tw.done)}
                  />
                </div>
              );
            })}
            {/* Show orchestrator thinking indicator while waiting for API response */}
            {sending && (
              <div className="flex w-full justify-start">
                <div
                  className="flex flex-col gap-1 rounded-2xl rounded-bl-sm px-4 py-3"
                  style={{ background: `${roleMeta.conductor.color}15`, border: `1px solid ${roleMeta.conductor.color}30` }}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-display text-[13px] font-semibold" style={{ color: roleMeta.conductor.color }}>Orchestrator</span>
                    <span className="flex items-center gap-1 font-mono text-[11px] text-[var(--text-3)]">
                      <span className="h-1.5 w-1.5 animate-blip rounded-full" style={{ background: roleMeta.conductor.color }} />
                      thinking
                    </span>
                  </div>
                </div>
              </div>
            )}
            {showTyping && activeRole && <Typing role={activeRole} preview={typingPreview} />}
          </>
        )}
      </div>
    </section>
  );
}
