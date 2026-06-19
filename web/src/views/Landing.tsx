import { useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { motion, useMotionValueEvent, useScroll } from "framer-motion";
import { BandFlow } from "../components/BandFlow";
import { Glyph } from "../components/Glyph";
import { roleMeta, signalOrder } from "../theme";
import type { Role } from "../types";
import type { Route } from "../useRoute";

const APP = "/app";
const DEMO = "/app?view=race&mode=replay&run=demo-golden";
const GITHUB = "https://github.com/singhh-piyush/Quartet";
// Smooth, slow deceleration (easeOutExpo-style) shared by every scroll reveal so sections glide in.
const SMOOTH: [number, number, number, number] = [0.16, 1, 0.3, 1];

// Full-bleed gutters: content runs to the screen edges with breathing room only at the sides. Used on every
// section so the borders and grids span edge to edge.
const GUTTER = "px-5 sm:px-8 lg:px-12 xl:px-20";

// Standalone marketing landing page (route "/"). Strict instrument-console theme: pure-black, solid colours
// only (no gradients), sharp 1px-bordered panels, and snappy circOut motion. The hero headline is colour-coded
// by role and the node graph runs a live continuous data-pulse (BandFlow). Leads into the studio ("/app");
// "Watch the demo" deep-links into the golden replay so it works with zero keys. Numbers are illustrative.
export function Landing({ route }: { route: Route }) {
  const go = (to: string) => (e: MouseEvent) => {
    e.preventDefault();
    route.navigate(to);
  };

  // Sticky top bar: the QUARTET wordmark collapses smoothly into the logo once the user scrolls.
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 40));

  return (
    <div className="relative min-h-screen overflow-x-clip bg-ink">
      {/* sticky top bar (fixed across the whole page); its separator fades in only once scrolled */}
      <motion.header
        className={`sticky top-0 z-50 flex items-center justify-between border-b bg-ink py-3 ${GUTTER}`}
        style={{ borderBottomColor: "rgba(255,255,255,0)" }}
        animate={{ borderBottomColor: scrolled ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0)" }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      >
        <a href="/" onClick={go("/")} className="flex items-center" aria-label="Quartet home">
          <Glyph size={15} />
          <motion.span
            className="overflow-hidden whitespace-nowrap font-display text-xl font-extrabold tracking-tight text-[var(--text)]"
            style={{ transformOrigin: "left center" }}
            animate={{
              maxWidth: scrolled ? 0 : 160,
              opacity: scrolled ? 0 : 1,
              marginLeft: scrolled ? 0 : 12,
              x: scrolled ? -8 : 0, // retract toward the logo as it collapses
            }}
            // strong ease-in-out (easeInOutQuart) so the collapse accelerates then settles, not a flat wipe
            transition={{ duration: 0.5, ease: [0.76, 0, 0.24, 1] }}
          >
            QUARTET
          </motion.span>
        </a>
        <nav className="flex items-center gap-2.5 sm:gap-3">
          <a
            href={GITHUB}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub repository"
            className="grid h-8 w-8 place-items-center rounded-sm border border-[var(--line)] text-[var(--text-3)] transition-colors hover:border-[var(--line-strong)] hover:text-white"
          >
            <GitHubIcon size={16} />
          </a>
          <motion.a
            href="#how"
            className="hidden rounded-sm border border-[var(--line)] px-4 py-1.5 font-sans text-sm font-semibold text-[var(--text-2)] sm:block"
            whileHover={{ borderColor: "rgba(255,255,255,0.55)", color: "#fff" }}
            transition={{ duration: 0.15, ease: "circOut" }}
          >
            How it works
          </motion.a>
          <motion.a
            href={APP}
            onClick={go(APP)}
            className="rounded-sm border border-[var(--line)] px-4 py-1.5 font-sans text-sm font-semibold text-[var(--text-2)]"
            whileHover={{ borderColor: "rgba(255,255,255,0.55)", color: "#fff" }}
            transition={{ duration: 0.15, ease: "circOut" }}
          >
            Open studio
          </motion.a>
        </nav>
      </motion.header>

      {/* hero */}
      <section className={`relative z-[1] flex min-h-[calc(100vh-57px)] flex-col justify-center py-14 ${GUTTER}`}>
          <Reveal immediate>
            <span className="font-mono text-[12px] uppercase tracking-[0.3em] text-[var(--text-3)]">
              Track 2 / multi-agent software development
            </span>
          </Reveal>

          <Reveal immediate delay={0.06}>
            <h1 className="mt-5 max-w-5xl font-display text-5xl font-extrabold leading-[1.02] tracking-tight sm:text-7xl lg:text-8xl">
              <span className="text-spec">Four</span> <span className="text-coder">small</span>{" "}
              <span className="text-tester">models.</span>
              <br />
              <span className="text-[var(--text)]">One big </span>
              <span className="text-repairer">result.</span>
            </h1>
          </Reveal>

          <Reveal immediate delay={0.12}>
            <p className="mt-6 max-w-2xl font-sans text-lg leading-relaxed text-[var(--text-2)]">
              Spec, Coder, Tester, and Repairer collaborate in one room through Band to write code and prove it
              passes a hidden test suite. A quartet of small open models matches a single large one, at a
              fraction of the cost.
            </p>
          </Reveal>

          <Reveal immediate delay={0.18}>
            <div className="mt-9 flex flex-wrap items-center gap-3.5">
              <motion.a
                href={APP}
                onClick={go(APP)}
                className="rounded-sm bg-[var(--accent)] px-6 py-3 font-sans text-base font-bold text-black"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                transition={{ duration: 0.15, ease: "circOut" }}
              >
                Enter the studio
              </motion.a>
              <motion.a
                href={DEMO}
                onClick={go(DEMO)}
                className="group flex items-center gap-2.5 rounded-sm border border-[var(--line)] px-6 py-3 font-sans text-base font-semibold text-[var(--text-2)]"
                whileHover={{ scale: 1.02, borderColor: "rgba(255,255,255,0.55)", color: "#fff" }}
                whileTap={{ scale: 0.98 }}
                transition={{ duration: 0.15, ease: "circOut" }}
              >
                <PlayIcon size={12} />
                Watch the demo
              </motion.a>
            </div>
          </Reveal>

          <Reveal immediate delay={0.24}>
            <p className="mt-4 font-mono text-[12px] text-[var(--text-3)]">
              No sign-up. The demo replays a recorded run, and live runs work on a shared key.
            </p>
          </Reveal>

          {/* the band line: the live signal path through the room */}
          <Reveal immediate delay={0.3} y={24}>
            <div className="mt-14">
              <BandFlow />
            </div>
          </Reveal>
      </section>

      {/* how it works */}
      <section id="how" className="relative z-[1]">
        <div className={`py-20 ${GUTTER}`}>
          <Reveal>
            <h2 className="font-display text-3xl font-bold tracking-tight text-[var(--text)] sm:text-4xl">
              One room. Four roles. A real handoff.
            </h2>
          </Reveal>
          <Reveal delay={0.06}>
            <p className="mt-3 max-w-2xl font-sans text-[var(--text-2)]">
              The agents are separate processes that coordinate only through Band, the collaboration layer.
              The loop runs Spec to Coder to Tester to Repairer, and bounces back on a failure until the tests
              pass.
            </p>
          </Reveal>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {signalOrder.map((r, idx) => (
              <RoleCard key={r} role={r} step={idx + 1} />
            ))}
          </div>
        </div>
      </section>

      {/* proof strip */}
      <section className="relative z-[1]">
        <div className={`py-16 ${GUTTER}`}>
          <div className="mb-7 flex items-center gap-3">
            <span className="font-mono text-[12px] uppercase tracking-[0.25em] text-[var(--text-3)]">the thesis</span>
            <span className="rounded-sm border border-[var(--line)] px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wider text-[var(--text-3)]">
              illustrative
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat value="On par" unit="Pass@1" note="quartet vs one large model" color="#34d399" step={0} />
            <Stat value="~5x" unit="cheaper" note="cost per solved problem" color="#38bdf8" step={1} />
            <Stat value="4 + 1" unit="in parallel" note="agents race the large model live" color="#a78bfa" step={2} />
          </div>
          <p className="mt-6 font-mono text-[12px] text-[var(--text-3)]">
            Numbers are illustrative. Run a live benchmark in the Stack Lab to measure Pass@1 and real cost
            from logged tokens.
          </p>
        </div>
      </section>

      {/* product surfaces */}
      <section className="relative z-[1]">
        <div className={`grid gap-4 py-16 md:grid-cols-2 ${GUTTER}`}>
          <SurfaceCard
            title="Build"
            color="#34d399"
            body="Describe a small project in plain language. Watch the quartet plan, write, test, and repair it live, then download the files."
            cta="Open Build"
            onClick={go(APP + "?view=build")}
            step={0}
          />
          <SurfaceCard
            title="Stack Lab"
            color="#38bdf8"
            body="Benchmark a stack of models over HumanEval with held-out scoring. Compare Pass@1, cost per solved, tokens, and latency side by side."
            cta="Open the Lab"
            onClick={go(APP + "?view=lab")}
            step={1}
          />
        </div>
      </section>

      <footer className="relative z-[1]">
        <div
          className={`flex flex-wrap items-center justify-between gap-4 py-8 font-mono text-[12px] uppercase tracking-widest text-[var(--text-3)] ${GUTTER}`}
        >
          <span className="flex items-center gap-2.5">
            <Glyph size={11} glow={false} />
            Quartet
          </span>
          <div className="flex flex-wrap items-center gap-5">
            <a
              href={GITHUB}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 transition-colors hover:text-white"
            >
              <GitHubIcon size={14} />
              GitHub
            </a>
            <span>Made by Piyush Singh</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

// Clean filled play triangle (replaces the boxed unicode glyph). Nudged right so it reads optically centred.
function PlayIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="currentColor" aria-hidden focusable="false">
      <path d="M2.5 1.4 8.6 5 2.5 8.6 Z" />
    </svg>
  );
}

function GitHubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden focusable="false">
      <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 005.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.5 7.5 0 014 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8 8 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

// Snappy, precise entrance: fades up with a short circOut transition (no spring overshoot). Above-the-fold
// hero items use `immediate` so they play on mount (never gated by the in-view observer); lower sections
// reveal on scroll-in.
function Reveal({
  children,
  delay = 0,
  y = 28,
  immediate = false,
  duration,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  immediate?: boolean;
  duration?: number;
  className?: string;
}) {
  const dur = duration ?? (immediate ? 0.65 : 0.9);
  const transition = { duration: dur, ease: SMOOTH, delay };
  if (immediate) {
    return (
      <motion.div className={className} initial={{ opacity: 0, y }} animate={{ opacity: 1, y: 0 }} transition={transition}>
        {children}
      </motion.div>
    );
  }
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -120px 0px" }}
      transition={transition}
    >
      {children}
    </motion.div>
  );
}

function RoleCard({ role, step }: { role: Role; step: number }) {
  const m = roleMeta[role];
  return (
    <motion.div
      className="panel-raised rounded-md p-5"
      style={{ borderColor: `${m.color}44` }}
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -100px 0px" }}
      transition={{ duration: 0.9, ease: SMOOTH, delay: step * 0.12 }}
      whileHover={{ scale: 1.01, borderColor: m.color, transition: { duration: 0.15, ease: "circOut" } }}
    >
      <div className="flex items-center justify-between">
        <span className="h-3 w-3 rounded-[3px]" style={{ background: m.color, boxShadow: `0 0 12px -2px ${m.color}` }} />
        <span className="font-mono text-[11px] text-[var(--text-3)]">0{step}</span>
      </div>
      <h3 className="mt-4 font-display text-lg font-bold" style={{ color: m.color }}>
        {m.label}
      </h3>
      <p className="mt-1.5 font-sans text-sm leading-relaxed text-[var(--text-2)]">{m.sub}</p>
    </motion.div>
  );
}

function Stat({
  value,
  unit,
  note,
  color,
  step,
}: {
  value: string;
  unit: string;
  note: string;
  color: string;
  step: number;
}) {
  return (
    <motion.div
      className="panel-raised rounded-md p-5"
      style={{ borderColor: `${color}44` }}
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -100px 0px" }}
      transition={{ duration: 0.85, ease: SMOOTH, delay: step * 0.12 }}
      whileHover={{ scale: 1.01, borderColor: color, transition: { duration: 0.15, ease: "circOut" } }}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-display text-3xl font-extrabold tracking-tight" style={{ color }}>
          {value}
        </span>
        <span className="font-mono text-[13px] uppercase tracking-wider text-[var(--text-3)]">{unit}</span>
      </div>
      <p className="mt-2 font-sans text-sm text-[var(--text-2)]">{note}</p>
    </motion.div>
  );
}

function SurfaceCard({
  title,
  color,
  body,
  cta,
  onClick,
  step = 0,
}: {
  title: string;
  color: string;
  body: string;
  cta: string;
  onClick: (e: MouseEvent) => void;
  step?: number;
}) {
  return (
    <motion.a
      href="#"
      onClick={onClick}
      className="panel-raised group flex flex-col rounded-md p-5"
      style={{ borderColor: `${color}44` } as CSSProperties}
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -100px 0px" }}
      transition={{ duration: 0.9, ease: SMOOTH, delay: step * 0.12 }}
      whileHover={{ scale: 1.01, borderColor: color, transition: { duration: 0.15, ease: "circOut" } }}
    >
      <div className="flex items-center gap-2.5">
        <span className="h-3 w-3 rounded-[3px]" style={{ background: color, boxShadow: `0 0 12px -2px ${color}` }} />
        <h3 className="font-display text-xl font-bold tracking-tight text-[var(--text)]">{title}</h3>
      </div>
      <p className="mt-2 flex-1 font-sans text-sm leading-relaxed text-[var(--text-2)]">{body}</p>
      <span className="mt-4 inline-flex items-center gap-2 font-sans text-sm font-semibold" style={{ color }}>
        {cta}
        <span className="transition-transform group-hover:translate-x-1">&rarr;</span>
      </span>
    </motion.a>
  );
}
