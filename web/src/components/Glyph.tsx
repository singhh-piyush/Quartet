import { roleMeta, signalOrder } from "../theme";

// The product mark: four squares in the agent accent colours (the quartet). Used in the app header and
// scaled up on the landing hero. Same shape everywhere so the brand is consistent.
export function Glyph({ size = 14, gap = 4, glow = true }: { size?: number; gap?: number; glow?: boolean }) {
  return (
    <div className="grid grid-cols-2" style={{ gap }}>
      {signalOrder.map((r) => (
        <span
          key={r}
          className="rounded-[3px]"
          style={{
            width: size,
            height: size,
            background: roleMeta[r].color,
            boxShadow: glow ? `0 0 ${Math.round(size * 0.8)}px -2px ${roleMeta[r].color}` : undefined,
          }}
        />
      ))}
    </div>
  );
}
