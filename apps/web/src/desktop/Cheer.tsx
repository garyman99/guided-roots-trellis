/**
 * CheerBurst — a brief full-desktop leaf-shower celebration fired once when
 * a learner passes their checkpoint ("Check my work"). Purely decorative:
 * `aria-hidden`, no focus, no layout impact (pointer-events: none). Respects
 * prefers-reduced-motion by rendering nothing (still calling onDone so the
 * parent's celebrate flag resets).
 */
import { useEffect, useMemo, useRef, type CSSProperties } from "react";

interface Piece {
  key: string;
  kind: "leaf" | "dot";
  style: Record<string, string>;
}

function buildPieces(): Piece[] {
  const pieces: Piece[] = [];
  for (let i = 0; i < 38; i++) {
    const isLeaf = i % 6 !== 0;
    const style: Record<string, string> = {
      "--x": `${Math.round(Math.random() * window.innerWidth)}px`,
      "--drift": `${Math.round(Math.random() * 90 - 45)}px`,
      "--dur": `${(2.8 + Math.random() * 1.6).toFixed(2)}s`,
      "--delay": `${(Math.random() * 1.6).toFixed(2)}s`,
      "--rot": `${Math.round(Math.random() * 720 - 360)}deg`,
    };
    if (isLeaf) {
      style["--sz"] = `${Math.round(14 + Math.random() * 13)}px`;
    } else {
      style["--c"] = Math.random() < 0.5 ? "#7fb069" : "#e8c268";
    }
    pieces.push({ key: `p${i}`, kind: isLeaf ? "leaf" : "dot", style });
  }
  return pieces;
}

export function CheerBurst({ active, onDone }: { active: boolean; onDone?: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (!active) return;
    const ms = reduced ? 0 : 6200;
    timer.current = setTimeout(() => onDone?.(), ms);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const pieces = useMemo(() => (active && !reduced ? buildPieces() : []), [active, reduced]);

  if (!active || reduced) return null;

  return (
    <div className="cheer-overlay" aria-hidden="true">
      {pieces.map((p) => (
        <span key={p.key} className={`cheer-piece${p.kind === "dot" ? " dot" : ""}`} style={p.style as CSSProperties}>
          {p.kind === "leaf" ? "🌿" : null}
        </span>
      ))}
    </div>
  );
}
