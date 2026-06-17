import { useState, type ReactNode } from "react";
import type { RoomState, Role, Transcript } from "../types";
import { AgentRail } from "./AgentRail";
import { BandRoom } from "./BandRoom";
import { ProofRail } from "./ProofRail";

// The Room is the live stage: a compact agent rail with the handoff light flowing through the
// stations, the Band chat as the hero, and a proof rail (race, code, tests, verdict). It fills the
// viewport so there is no dead space and no scrolling wall; each panel scrolls internally.
export function RoomView({
  room,
  transcript,
  controls,
  error,
  live = true,
}: {
  room: RoomState;
  transcript: Transcript | null;
  controls: ReactNode;
  error?: string | null;
  live?: boolean;
}) {
  const [focus, setFocus] = useState<Role | null>(null);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3.5">
      <div className="shrink-0">{controls}</div>

      {error && (
        <div className="shrink-0 rounded-lg border border-fail/40 bg-fail/10 px-4 py-2 font-mono text-sm text-fail">
          {error}
        </div>
      )}

      <div className="shrink-0">
        <AgentRail room={room} focus={focus} onFocus={(r) => setFocus((f) => (f === r ? null : r))} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3.5 lg:grid-cols-[1.4fr_1fr]">
        <div className="min-h-[55vh] lg:min-h-0">
          <BandRoom transcript={transcript} room={room} live={live} focus={focus} />
        </div>
        <div className="min-h-[55vh] lg:min-h-0">
          <ProofRail room={room} />
        </div>
      </div>
    </div>
  );
}
