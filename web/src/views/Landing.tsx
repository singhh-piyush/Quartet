import type { CSSProperties, MouseEvent } from "react";
import { Glyph } from "../components/Glyph";
import { roleMeta, signalOrder } from "../theme";
import type { Role } from "../types";
import type { Route } from "../useRoute";

const APP = "/app";
const DEMO = "/app?view=race&mode=replay&run=demo-golden";

// Standalone marketing landing page (route "/"). Pure-black instrument-console theme, the four agent
// colours as the quartet. Leads into the studio ("/app"); "Watch the demo" deep-links into the golden
// replay so it works with zero keys and no model server. Numbers are illustrative and badged as such.
export function Landing({ route }: { route: Route }) {
  const go = (to: string) => (e: MouseEvent) => {
    e.preventDefault();
    route.navigate(to);
  };

  let i = 0; // running reveal index for the staggered entrance
  const reveal = () => ({ "--i": i++ }) as CSSProperties;

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="landing-aura" />

      <div className="relative z-[1] mx-auto flex min-h-screen max-w-6xl flex-col px-6 sm:px-8">
        {/* top bar */}
        <header className="flex items-center justify-between py-6">
          <a href="/" onClick={go("/")} className="flex items-center gap-3">
            <Glyph size={15} />
            <span className="font-display text-xl font-extrabold tracking-tight text-[var(--text)]">QUARTET</span>
          </a>
          <nav className="flex items-center gap-5">
            <a
              href="#how"
              className="hidden font-mono text-[12px] uppercase tracking-widest text-[var(--text-3)] transition-colors hover:text-[var(--text)] sm:block"
            >
              How it works
            </a>
            <a
              href={APP}
              onClick={go(APP)}
              className="rounded-lg border border-[var(--line)] px-4 py-1.5 font-sans text-sm font-semibold text-[var(--text-2)] transition-colors hover:border-[var(--line-strong)] hover:text-white"
            >
              Open studio
            </a>
          </nav>
        </header>

        {/* hero */}
        <section className="flex flex-1 flex-col justify-center py-12">
          <span className="reveal font-mono text-[12px] uppercase tracking-[0.3em] text-[var(--text-3)]" style={reveal()}>
            Track 2 / multi-agent software development
          </span>

          <h1
            className="reveal mt-5 max-w-3xl font-display text-5xl font-extrabold leading-[1.04] tracking-tight text-[var(--text)] sm:text-6xl lg:text-7xl"
            style={reveal()}
          >
            Four small models.
            <br />
            <span className="text-gradient">One big result.</span>
          </h1>

          <p className="reveal mt-6 max-w-2xl font-sans text-lg leading-relaxed text-[var(--text-2)]" style={reveal()}>
            Spec, Coder, Tester, and Repairer collaborate in one room through Band to write code and prove it
            passes a hidden test suite. A quartet of small open models matches a single large one, at a
            fraction of the cost.
          </p>

          <div className="reveal mt-9 flex flex-wrap items-center gap-3.5" style={reveal()}>
            <a
              href={APP}
              onClick={go(APP)}
              className="rounded-xl bg-repairer px-6 py-3 font-sans text-base font-bold text-black shadow-[0_0_34px_-8px_var(--repairer)] transition-transform hover:scale-[1.03]"
            >
              Enter the studio
            </a>
            <a
              href={DEMO}
              onClick={go(DEMO)}
              className="group flex items-center gap-2.5 rounded-xl border border-[var(--line)] px-6 py-3 font-sans text-base font-semibold text-[var(--text-2)] transition-colors hover:border-[var(--line-strong)] hover:text-white"
            >
              <span className="grid h-5 w-5 place-items-center rounded-full border border-[var(--line-strong)] text-[10px] transition-colors group-hover:bg-white/10">
                &#9654;
              </span>
              Watch the demo
            </a>
          </div>
          <p className="reveal mt-4 font-mono text-[12px] text-[var(--text-3)]" style={reveal()}>
            No sign-up. The demo replays a recorded run, and live runs work on a shared key.
          </p>

          {/* the band line: the signal path through the room */}
          <div className="reveal mt-14" style={reveal()}>
            <BandLine />
          </div>
        </section>
      </div>

      {/* how it works */}
      <section id="how" className="relative z-[1] border-t border-[var(--line)] bg-black/30">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:px-8">
          <h2 className="font-display text-3xl font-bold tracking-tight text-[var(--text)]">
            One room. Four roles. A real handoff.
          </h2>
          <p className="mt-3 max-w-2xl font-sans text-[var(--text-2)]">
            The agents are separate processes that coordinate only through Band, the collaboration layer.
            The loop runs Spec to Coder to Tester to Repairer, and bounces back on a failure until the tests
            pass.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {signalOrder.map((r, idx) => (
              <RoleCard key={r} role={r} step={idx + 1} />
            ))}
          </div>
        </div>
      </section>

      {/* proof strip */}
      <section className="relative z-[1] border-t border-[var(--line)]">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:px-8">
          <div className="mb-7 flex items-center gap-3">
            <span className="font-mono text-[12px] uppercase tracking-[0.25em] text-[var(--text-3)]">the thesis</span>
            <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wider text-[var(--text-3)]">
              illustrative
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat value="On par" unit="Pass@1" note="quartet vs one large model" color="var(--repairer)" />
            <Stat value="~5x" unit="cheaper" note="cost per solved problem" color="var(--spec)" />
            <Stat value="4 + 1" unit="in parallel" note="agents race the large model live" color="var(--coder)" />
          </div>
          <p className="mt-6 font-mono text-[12px] text-[var(--text-3)]">
            Numbers are illustrative. Run a live benchmark in the Stack Lab to measure Pass@1 and real cost
            from logged tokens.
          </p>
        </div>
      </section>

      {/* product surfaces */}
      <section className="relative z-[1] border-t border-[var(--line)] bg-black/30">
        <div className="mx-auto grid max-w-6xl gap-4 px-6 py-16 sm:px-8 md:grid-cols-2">
          <SurfaceCard
            title="Build"
            color="var(--repairer)"
            body="Describe a small project in plain language. Watch the quartet plan, write, test, and repair it live, then download the files."
            cta="Open Build"
            onClick={go(APP + "?view=build")}
          />
          <SurfaceCard
            title="Stack Lab"
            color="var(--spec)"
            body="Benchmark a stack of models over HumanEval with held-out scoring. Compare Pass@1, cost per solved, tokens, and latency side by side."
            cta="Open the Lab"
            onClick={go(APP + "?view=lab")}
          />
        </div>
      </section>

      <footer className="relative z-[1] border-t border-[var(--line)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 font-mono text-[12px] uppercase tracking-widest text-[var(--text-3)] sm:px-8">
          <span className="flex items-center gap-2.5">
            <Glyph size={11} glow={false} />
            Quartet
          </span>
          <span>Track 2 / multi-agent software development</span>
        </div>
      </footer>
    </div>
  );
}

// The four role nodes wired left to right, a static echo of the in-app AgentRail.
function BandLine() {
  return (
    <div className="flex items-center">
      {signalOrder.map((r, idx) => (
        <div key={r} className="flex flex-1 items-center last:flex-none">
          <div
            className="flex items-center gap-2.5 rounded-lg border bg-[var(--panel)] px-3.5 py-2.5"
            style={{ borderColor: `${roleMeta[r].color}55`, boxShadow: `0 0 24px -14px ${roleMeta[r].color}` }}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: roleMeta[r].color, boxShadow: `0 0 8px ${roleMeta[r].color}` }} />
            <span className="font-display text-sm font-semibold" style={{ color: roleMeta[r].color }}>
              {roleMeta[r].label}
            </span>
          </div>
          {idx < signalOrder.length - 1 && (
            <div className="hidden h-px flex-1 sm:block" style={{ background: `linear-gradient(to right, ${roleMeta[r].color}66, ${roleMeta[signalOrder[idx + 1]].color}66)` }} />
          )}
        </div>
      ))}
    </div>
  );
}

function RoleCard({ role, step }: { role: Role; step: number }) {
  const m = roleMeta[role];
  return (
    <div
      className="reveal panel-raised rounded-xl p-5"
      style={{ borderColor: `${m.color}44`, "--i": step } as CSSProperties}
    >
      <div className="flex items-center justify-between">
        <span className="h-3 w-3 rounded-[3px]" style={{ background: m.color, boxShadow: `0 0 12px -2px ${m.color}` }} />
        <span className="font-mono text-[11px] text-[var(--text-3)]">0{step}</span>
      </div>
      <h3 className="mt-4 font-display text-lg font-bold" style={{ color: m.color }}>
        {m.label}
      </h3>
      <p className="mt-1.5 font-sans text-sm leading-relaxed text-[var(--text-2)]">{m.sub}</p>
    </div>
  );
}

function Stat({ value, unit, note, color }: { value: string; unit: string; note: string; color: string }) {
  return (
    <div className="panel-raised rounded-xl p-6">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-4xl font-extrabold tracking-tight" style={{ color }}>
          {value}
        </span>
        <span className="font-mono text-[13px] uppercase tracking-wider text-[var(--text-3)]">{unit}</span>
      </div>
      <p className="mt-2 font-sans text-sm text-[var(--text-2)]">{note}</p>
    </div>
  );
}

function SurfaceCard({
  title,
  color,
  body,
  cta,
  onClick,
}: {
  title: string;
  color: string;
  body: string;
  cta: string;
  onClick: (e: MouseEvent) => void;
}) {
  return (
    <a
      href="#"
      onClick={onClick}
      className="panel-raised group flex flex-col rounded-2xl p-7 transition-transform hover:scale-[1.01]"
      style={{ borderColor: `${color}44` }}
    >
      <div className="flex items-center gap-3">
        <span className="h-3.5 w-3.5 rounded-[3px]" style={{ background: color, boxShadow: `0 0 14px -2px ${color}` }} />
        <h3 className="font-display text-2xl font-bold tracking-tight text-[var(--text)]">{title}</h3>
      </div>
      <p className="mt-3 flex-1 font-sans text-[15px] leading-relaxed text-[var(--text-2)]">{body}</p>
      <span
        className="mt-5 inline-flex items-center gap-2 font-sans text-sm font-semibold transition-colors"
        style={{ color }}
      >
        {cta}
        <span className="transition-transform group-hover:translate-x-1">&rarr;</span>
      </span>
    </a>
  );
}
