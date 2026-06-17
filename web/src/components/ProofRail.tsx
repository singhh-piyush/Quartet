import type { RoomState } from "../types";
import { ChallengerLane } from "./ChallengerLane";
import { CodePanel } from "./CodePanel";
import { TestPanel } from "./TestPanel";
import { VerdictBanner } from "./VerdictBanner";

// The right rail: the proof that the collaboration produced a working solution. Race at the top, the
// candidate code that flips red->green in the flexible middle, the per-case tester suite below, and a
// slim PASS@1 crown when the held-out test scores. Fills the column height; panels scroll internally.
export function ProofRail({ room }: { room: RoomState }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <VerdictBanner room={room} />
      <ChallengerLane room={room} />
      <div className="min-h-0 flex-[3]">
        <CodePanel code={room.code} runs={room.code.runs} />
      </div>
      <div className="min-h-0 flex-[2]">
        <TestPanel room={room} />
      </div>
    </div>
  );
}
