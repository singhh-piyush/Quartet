import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { fetchProjectFile, projectZipUrl } from "../api";
import type { ProjectInfo, RoomState, Transcript } from "../types";
import { BandRoom } from "./BandRoom";
import { FileTree } from "./FileTree";
import { ProjectPreviewFrame } from "./ProjectPreviewFrame";

type Tab = "chat" | "files" | "readme" | "preview";

// The right rail of the build workspace: the produced project. A file tree + viewer, the README, and a
// live iframe preview for static sites, plus a Download .zip. Replaces the race ProofRail in build mode.
export function OutputPanel({
  project,
  runId,
  liveCode = "",
  transcript,
  room,
  live,
}: {
  project: ProjectInfo | null;
  runId: string | null;
  // Latest candidate code from the room, shown streaming in the output window before the finished
  // multi-file project lands on disk.
  liveCode?: string;
  transcript?: Transcript | null;
  room?: RoomState;
  live?: boolean;
}) {
  const isStatic = project?.type === "static" && project?.has_static_entry;
  const [tab, setTab] = useState<Tab>("chat");
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");

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
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0 flex flex-col"
          >
            {tab === "chat" && room ? (
              <BandRoom transcript={transcript || null} room={room} live={live || false} focus={null} embedded filterType="agents-only" />
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
              <div className="h-full overflow-auto p-6">
                <article className="prose prose-sm prose-invert max-w-none prose-pre:bg-black/50 prose-pre:border prose-pre:border-[var(--line)] prose-a:text-spec">
                  <ReactMarkdown>{project.readme || "(no README)"}</ReactMarkdown>
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
