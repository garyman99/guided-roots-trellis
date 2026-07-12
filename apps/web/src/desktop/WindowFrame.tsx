/**
 * WindowFrame — one draggable, resizable desktop window.
 *
 * OS-VARIANT CHROME: the title-bar layout is delegated to <WindowControls os>
 * so a macOS-styled shell later is a variant of this component, not a fork:
 * windows → controls right (─ □ ✕), title left; mac → traffic lights left,
 * title centered. Only "windows" is implemented (and verified) today.
 */
import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

export type OsStyle = "windows" | "mac";

export interface WindowRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WindowState {
  open: boolean;
  minimized: boolean;
  maximized: boolean;
  rect: WindowRect;
  z: number;
}

function WindowControls({
  os,
  onMinimize,
  onMaximize,
  onClose,
}: {
  os: OsStyle;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
}) {
  if (os === "mac") {
    // FUTURE VARIANT (unverified stub): traffic lights, left-aligned.
    return (
      <div className="win-controls mac">
        <button className="traffic close" aria-label="Close" onClick={onClose} />
        <button className="traffic min" aria-label="Minimize" onClick={onMinimize} />
        <button className="traffic max" aria-label="Maximize" onClick={onMaximize} />
      </div>
    );
  }
  return (
    <div className="win-controls windows">
      <button className="winbtn" aria-label="Minimize" onClick={onMinimize}>
        ─
      </button>
      <button className="winbtn" aria-label="Maximize" onClick={onMaximize}>
        ☐
      </button>
      <button className="winbtn winbtn-close" aria-label="Close" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}

export function WindowFrame({
  os,
  appId,
  title,
  icon,
  state,
  onChange,
  onFocus,
  onClose,
  children,
}: {
  os: OsStyle;
  /** Stable app id stamped on the DOM so the shell can move keyboard focus into a fronted window. */
  appId: string;
  title: string;
  icon: string;
  state: WindowState;
  onChange: (next: Partial<WindowState>) => void;
  onFocus: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const dragging = useRef<{ startX: number; startY: number; rect: WindowRect; mode: "move" | "resize" } | null>(null);

  const onPointerDown = (mode: "move" | "resize") => (e: ReactPointerEvent) => {
    if (state.maximized) return;
    dragging.current = { startX: e.clientX, startY: e.clientY, rect: state.rect, mode };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = dragging.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.mode === "move") {
      onChange({
        rect: {
          ...d.rect,
          x: Math.max(-d.rect.w + 120, Math.min(d.rect.x + dx, window.innerWidth - 80)),
          y: Math.max(0, Math.min(d.rect.y + dy, window.innerHeight - 96)),
        },
      });
    } else {
      onChange({ rect: { ...d.rect, w: Math.max(420, d.rect.w + dx), h: Math.max(280, d.rect.h + dy) } });
    }
  };
  const onPointerUp = () => {
    dragging.current = null;
  };

  if (!state.open || state.minimized) return null;
  const style = state.maximized
    ? { left: 0, top: 0, width: "100vw", height: "calc(100vh - var(--taskbar-h))", zIndex: state.z }
    : { left: state.rect.x, top: state.rect.y, width: state.rect.w, height: state.rect.h, zIndex: state.z };

  return (
    <section
      className={`window${state.maximized ? " maximized" : ""}`}
      style={style}
      data-app-id={appId}
      tabIndex={-1}
      onPointerDown={onFocus}
    >
      <header
        className="win-titlebar"
        onPointerDown={onPointerDown("move")}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => onChange({ maximized: !state.maximized })}
      >
        <span className="win-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="win-title">{title}</span>
        <WindowControls
          os={os}
          onMinimize={() => onChange({ minimized: true })}
          onMaximize={() => onChange({ maximized: !state.maximized })}
          onClose={onClose}
        />
      </header>
      <div className="win-body">{children}</div>
      {!state.maximized && (
        <div
          className="win-resize"
          aria-hidden="true"
          onPointerDown={onPointerDown("resize")}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      )}
    </section>
  );
}
