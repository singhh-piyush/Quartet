import { useRef, useState, type ReactNode } from "react";
import { signalOrder } from "../theme";
import type { RoomState, Role, Transcript } from "../types";
import { useCardRects } from "../useCardRects";
import { useFlowState } from "../useFlowState";
import { AgentCard } from "./AgentCard";
import { ChallengerLane } from "./ChallengerLane";
import { CodePanel } from "./CodePanel";
import { HandoffFeed } from "./HandoffFeed";
import { ReasoningPanel } from "./ReasoningPanel";
import { SignalFlow } from "./SignalFlow";
import { TestPanel } from "./TestPanel";
import { TokenMeter } from "./TokenMeter";
import { VerdictBanner } from "./VerdictBanner";

export function RoomView({
  room,
  transcript,
  controls,
  error,
  animate = true,
}: {
  room: RoomState;
  transcript: Transcript | null;
  controls: ReactNode;
  error?: string | null;
  animate?: boolean;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Partial<Record<Role, HTMLElement | null>>>({});
  const { rects, containerWidth, containerHeight } = useCardRects(railRef, cardRefs);
  const segment = useFlowState(room);

  const [pinned, setPinned] = useState<Role | null>(null);
  const selected: Role = pinned ?? room.activeRole ?? "spec";
  const animClass = animate ? "animate-stationIn" : "";

  return (
    <div className="flex flex-col gap-4">
      <div className={animClass}>{controls}</div>

      {error && (
        <div className="rounded-lg border border-fail/40 bg-fail/10 px-4 py-2 font-mono text-sm text-fail">
          {error}
        </div>
      )}

      {/* signal path: Spec -> Coder -> Tester -> Repairer, with the flow overlay between stations.
          A uniform grid (equal columns, equal rows via auto-rows-fr) keeps every card identical at
          any width; the SVG flow overlay shows at md+ where the four cards sit on one row. */}
      <div ref={railRef} className="relative grid grid-cols-2 gap-3 [grid-auto-rows:1fr] md:grid-cols-4 md:gap-5">
        <SignalFlow
          rects={rects}
          containerWidth={containerWidth}
          containerHeight={containerHeight}
          segment={segment}
          verdict={room.verdict}
          finished={room.finished}
        />
        {signalOrder.map((role, i) => (
          <AgentCard
            key={role}
            ref={(el) => {
              cardRefs.current[role] = el;
            }}
            role={role}
            state={room.agents[role]}
            active={room.activeRole === role && !room.finished}
            index={i}
            animate={animate}
            selected={selected === role}
            onSelect={() => setPinned(role)}
          />
        ))}
      </div>

      <div className={animClass} style={animate ? { animationDelay: "350ms" } : undefined}>
        <ChallengerLane room={room} />
      </div>

      {/* reasoning (left, the centerpiece) and the code / test readouts (right) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.15fr_1fr]">
        <div className="h-[460px]">
          <ReasoningPanel transcript={transcript} room={room} selected={selected} />
        </div>
        <div className="flex h-[460px] flex-col gap-4">
          <div className="min-h-0 flex-1">
            <CodePanel code={room.code} runs={room.code.runs} />
          </div>
          <div className="min-h-0 flex-1">
            <TestPanel room={room} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="h-[300px]">
          <HandoffFeed feed={room.feed} />
        </div>
        <TokenMeter room={room} animate={animate} />
      </div>

      <VerdictBanner room={room} />
    </div>
  );
}
