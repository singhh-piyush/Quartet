import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "github-markdown-css/github-markdown-dark.css";
import { fetchProjectFile, projectZipUrl } from "../api";
import { ACTIVE_PHASES, phaseLabel, roleMeta, signalOrder } from "../theme";
import type { ProjectInfo, RoomState, Transcript } from "../types";
import { BandRoom } from "./BandRoom";
import { FileTree } from "./FileTree";
import { ProjectPreviewFrame } from "./ProjectPreviewFrame";

type Tab = "chat" | "files" | "readme" | "preview";

// Compact, inline agent activity: the four stations as a thin row of chips (dot + label), the active
// one pulsing.
function AgentStrip({ room }: { room: RoomState }) {
  return (
    <div className="flex items-center gap-1">
      {signalOrder.map((r) => {
        const a = room.agents[r];
        const meta = roleMeta[r];
        const active = !!a && ACTIVE_PHASES.has(a.phase);
        const on = !!a?.connected;
        return (
          <span
            key={r}
            title={`${meta.label}: ${phaseLabel[a?.phase ?? "idle"]}`}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5"
            style={{ background: active ? `${meta.color}1a` : "transparent" }}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${active ? "animate-blip" : ""}`}
              style={{ background: on ? meta.color : "var(--text-3)", opacity: on ? 1 : 0.4 }}
            />
            <span
              className="font-mono text-[10.5px] uppercase tracking-wide"
              style={{ color: active ? meta.color : "var(--text-3)" }}
            >
              {meta.label}
            </span>
          </span>
        );
      })}
    </div>
  );
}

// The right rail of the build workspace: the produced project. A file tree + viewer, the README, and a
// live iframe preview for static sites, plus a Download .zip. Replaces the race ProofRail in build mode.
export function OutputPanel({
  project,
  runId,
  liveCode = "",
  transcript,
  room,
  live,
  buildDone = false,
}: {
  project: ProjectInfo | null;
  runId: string | null;
  // Latest candidate code from the room, shown streaming in the output window before the finished
  // multi-file project lands on disk.
  liveCode?: string;
  transcript?: Transcript | null;
  room?: RoomState;
  live?: boolean;
  // buildDone: when true and the project is a static site, auto-switch to preview.
  buildDone?: boolean;
}) {
  const isStatic = project?.type === "static" && project?.has_static_entry;
  const [tab, setTab] = useState<Tab>("chat");
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const autoSwitched = useRef(false);

  // Auto-switch to preview tab when the build is done and it's a static site.
  useEffect(() => {
    if (buildDone && isStatic && !autoSwitched.current) {
      autoSwitched.current = true;
      setTab("preview");
    }
  }, [buildDone, isStatic]);

  // Default the selection to the first non-README file once a project lands.
  useEffect(() => {
    if (!project || project.files.length === 0) {
      setSelected(null);
      return;
    }
    if (!selected || !project.files.some((f) => f.path === selected)) {
      const first = project.files.find((f) => f.path.toLowerCase() !== "readme.md") ?? project.files[0];
      setSelected(first.path);
    }
  }, [project, selected]);

  useEffect(() => {
    if (!runId || !selected) {
      setContent("");
      return;
    }
    let alive = true;
    fetchProjectFile(runId, selected)
      .then((f) => alive && setContent(f.content))
      .catch(() => alive && setContent("(could not load file)"));
    return () => {
      alive = false;
    };
  }, [runId, selected]);

  const verdict =
    project?.passed == null ? null : project.passed ? { label: "build passed", color: "var(--pass)" } : { label: "build failed", color: "var(--fail)" };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl panel-raised">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-display text-[15px] font-semibold text-[var(--text)]">Output</span>
          {project?.type && (
            <span className="rounded bg-white/8 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wider text-[var(--text-2)]">
              {project.type}
            </span>
          )}
          {verdict && (
            <span className="font-mono text-[11px] font-semibold" style={{ color: verdict.color }}>
              {verdict.label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <TabBtn active={tab === "chat"} onClick={() => setTab("chat")}>Agent Chat</TabBtn>
          <TabBtn active={tab === "files"} onClick={() => setTab("files")}>Files</TabBtn>
          <TabBtn active={tab === "readme"} onClick={() => setTab("readme")}>README</TabBtn>
          {isStatic && <TabBtn active={tab === "preview"} onClick={() => setTab("preview")}>Preview</TabBtn>}
          {runId && project && (
            <a
              href={projectZipUrl(runId)}
              className="ml-1 rounded-md bg-repairer/20 px-3 py-1 font-sans text-[13px] font-semibold text-repairer transition-colors hover:bg-repairer/30"
            >
              Download .zip
            </a>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0 flex flex-col"
          >
            {tab === "chat" && room ? (
              <div className="flex h-full flex-col">
                <div className="flex shrink-0 items-center justify-between border-b border-[var(--line)] bg-[var(--bg)] px-4 py-2.5">
                  <span className="font-display text-[15px] font-semibold text-[var(--text)]">Agents</span>
                  <AgentStrip room={room} />
                </div>
                <div className="min-h-0 flex-1">
                  <BandRoom transcript={transcript || null} room={room} live={live || false} focus={null} embedded filterType="agents-only" animate={live || false} />
                </div>
              </div>
            ) : !project ? (
              liveCode ? (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex shrink-0 items-center gap-2 border-b border-[var(--line)] px-4 py-1.5">
                    <span className="h-1.5 w-1.5 animate-blip rounded-full bg-coder" />
                    <span className="font-mono text-[11px] uppercase tracking-widest text-coder">writing code</span>
                  </div>
                  <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[12.5px] leading-relaxed text-[var(--text)]">
                    {liveCode}
                  </pre>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center px-6 text-center">
                  <p className="font-mono text-[12.5px] leading-relaxed text-[var(--text-3)]">
                    The finished project appears here: a file tree, the README, a download, and a live preview
                    for static pages. Describe what to build and run it.
                  </p>
                </div>
              )
            ) : tab === "files" ? (
              <div className="grid h-full min-h-0 grid-cols-[minmax(8rem,11rem)_1fr]">
                <div className="min-h-0 overflow-y-auto border-r border-[var(--line)] p-2">
                  <FileTree files={project.files} selected={selected} onSelect={setSelected} />
                </div>
                <pre className="min-h-0 overflow-auto p-3 font-mono text-[12.5px] leading-relaxed text-[var(--text)]">
                  {content}
                </pre>
              </div>
            ) : tab === "readme" ? (
              <div className="h-full overflow-auto p-6" style={{ background: "var(--bg)" }}>
                <article className="markdown-body" style={{ background: "transparent" }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{project.readme || "(no README)"}</ReactMarkdown>
                </article>
              </div>
            ) : (
              <div className="h-full p-3">
                {runId && <ProjectPreviewFrame runId={runId} />}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 font-mono text-[11.5px] uppercase tracking-wider transition-colors ${
        active ? "bg-white/10 text-white" : "text-[var(--text-3)] hover:text-[var(--text-2)]"
      }`}
    >
      {children}
    </button>
  );
}
