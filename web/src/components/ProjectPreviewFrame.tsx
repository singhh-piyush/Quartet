import { projectPreviewUrl } from "../api";

// Live preview of a static project, served from the demo server's per-run project dir. The iframe is
// sandboxed (scripts allowed, but isolated from the parent origin) because the HTML/JS is model
// generated and untrusted. Python projects never render here; they only run in the sandbox.
export function ProjectPreviewFrame({ runId }: { runId: string }) {
  return (
    <iframe
      title="project preview"
      src={projectPreviewUrl(runId)}
      sandbox="allow-scripts"
      className="h-full w-full rounded-md border border-[var(--line)] bg-white"
    />
  );
}
