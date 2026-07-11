/**
 * Desktop — the full desktop-style learner experience.
 *
 * A brand-new user's real first hurdle is "what do I even open?". So the
 * lesson starts on a desktop: icons, a taskbar, a Start menu — and the Guide
 * window (lesson + instructor) open by default, telling them what to open
 * next. Code Studio is the star: explorer, editor, integrated terminal.
 *
 * OS STYLING: `data-os` on the root drives the chrome variant. "windows" is
 * implemented (taskbar + Start, controls right); "mac" (menu bar + dock,
 * traffic lights left) is a planned variant of the same components — see
 * WindowFrame's WindowControls seam. Select via ?os=… when it lands.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import "./desktop.css";
import { api, type SessionCredentials, type StatePayload } from "../api.ts";
import { InstructorPanel, InterventionToast, LessonPanel } from "../panels.tsx";
import { CodeStudio } from "./CodeStudio.tsx";
import { WindowFrame, type OsStyle, type WindowState } from "./WindowFrame.tsx";

type AppId = "guide" | "code" | "preview";

interface AppSpec {
  id: AppId;
  title: string;
  icon: string;
  initial: (i: number) => WindowState;
}

const APPS: AppSpec[] = [
  {
    id: "code",
    title: "Code Studio",
    icon: "🧩",
    initial: () => ({
      open: false,
      minimized: false,
      maximized: false,
      rect: { x: 60, y: 40, w: Math.min(1020, window.innerWidth - 480), h: window.innerHeight - 160 },
      z: 1,
    }),
  },
  {
    id: "guide",
    title: "Trellis Guide",
    icon: "🌿",
    initial: () => ({
      open: true, // the one thing already open when you "sit down"
      minimized: false,
      maximized: false,
      rect: { x: window.innerWidth - 420, y: 28, w: 392, h: window.innerHeight - 140 },
      z: 2,
    }),
  },
  {
    id: "preview",
    title: "Garden Site",
    icon: "🌐",
    initial: () => ({
      open: false,
      minimized: false,
      maximized: false,
      rect: { x: 140, y: 90, w: 640, h: 560 },
      z: 1,
    }),
  },
];

function GuideApp({
  creds,
  data,
  onNewData,
}: {
  creds: SessionCredentials;
  data: StatePayload;
  onNewData: (d: StatePayload) => void;
}) {
  const [tab, setTab] = useState<"lesson" | "instructor">("lesson");
  return (
    <div className="guide-app">
      <div className="guide-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "lesson"} className={tab === "lesson" ? "active" : ""} onClick={() => setTab("lesson")}>
          Lesson
        </button>
        <button
          role="tab"
          aria-selected={tab === "instructor"}
          className={tab === "instructor" ? "active" : ""}
          onClick={() => setTab("instructor")}
        >
          Instructor
        </button>
      </div>
      <div className="guide-body">
        {tab === "lesson" ? <LessonPanel creds={creds} data={data} /> : <InstructorPanel creds={creds} data={data} onNewData={onNewData} />}
      </div>
    </div>
  );
}

/** A browser-looking window rendering the lab's static site from the workspace. */
function PreviewApp({ creds }: { creds: SessionCredentials }) {
  const [doc, setDoc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => {
    setErr(null);
    api
      .fsRead(creds, "app/index.html")
      .then((r) => setDoc(r.content))
      .catch(() => setErr("This project has no app/index.html to preview."));
  };
  useEffect(load, [creds]);
  return (
    <div className="preview-app">
      <div className="preview-bar">
        <button className="ghost" onClick={load} title="Reload">
          ⟳
        </button>
        <span className="preview-address">garden-site/app/index.html — local preview</span>
      </div>
      {err ? (
        <p className="preview-err">{err}</p>
      ) : doc === null ? (
        <p className="preview-err">Loading…</p>
      ) : (
        // sandboxed: unique origin, scripts only — the page under test runs
        // exactly as Playwright sees it, isolated from the platform.
        <iframe className="preview-frame" title="Site preview" sandbox="allow-scripts" srcDoc={doc} />
      )}
    </div>
  );
}

export function Desktop({
  os,
  creds,
  data,
  onNewData,
}: {
  os: OsStyle;
  creds: SessionCredentials;
  data: StatePayload;
  onNewData: (d: StatePayload) => void;
}) {
  const [windows, setWindows] = useState<Record<AppId, WindowState>>(() =>
    Object.fromEntries(APPS.map((a, i) => [a.id, a.initial(i)])) as Record<AppId, WindowState>,
  );
  const [startOpen, setStartOpen] = useState(false);
  const [selectedIcon, setSelectedIcon] = useState<AppId | null>(null);
  const zRef = useRef(10);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // The preview app only exists for labs that ship a static site.
  const [hasSite, setHasSite] = useState(false);
  useEffect(() => {
    api.fsRead(creds, "app/index.html").then(() => setHasSite(true)).catch(() => setHasSite(false));
  }, [creds]);
  const visibleApps = useMemo(() => APPS.filter((a) => a.id !== "preview" || hasSite), [hasSite]);

  const update = (id: AppId, next: Partial<WindowState>) =>
    setWindows((w) => ({ ...w, [id]: { ...w[id], ...next } }));
  const focusWin = (id: AppId) => update(id, { z: ++zRef.current });
  const openApp = (id: AppId) => {
    setStartOpen(false);
    setSelectedIcon(null);
    update(id, { open: true, minimized: false, z: ++zRef.current });
  };
  const taskbarClick = (id: AppId) => {
    const w = windows[id];
    if (!w.open) return openApp(id);
    if (w.minimized) return update(id, { minimized: false, z: ++zRef.current });
    update(id, { minimized: true });
  };

  const fmtClock = clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const fmtDate = clock.toLocaleDateString([], { month: "short", day: "numeric" });

  return (
    <div className="desktop" data-os={os} onClick={() => setStartOpen(false)}>
      <ul className="desktop-icons">
        {visibleApps.map((a) => (
          <li key={a.id}>
            <button
              className={`desk-icon${selectedIcon === a.id ? " selected" : ""}`}
              aria-label={`${a.title} (double-click to open)`}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedIcon(a.id);
              }}
              onDoubleClick={() => openApp(a.id)}
            >
              <span className="desk-icon-glyph" aria-hidden="true">
                {a.icon}
              </span>
              <span className="desk-icon-label">{a.title}</span>
            </button>
          </li>
        ))}
      </ul>

      {visibleApps.map((a) => (
        <WindowFrame
          key={a.id}
          os={os}
          title={a.id === "guide" ? `${a.title} — ${data.lab.title}` : a.title}
          icon={a.icon}
          state={windows[a.id]}
          onChange={(next) => update(a.id, next)}
          onFocus={() => focusWin(a.id)}
          onClose={() => update(a.id, { open: false })}
        >
          {a.id === "code" && <CodeStudio creds={creds} />}
          {a.id === "guide" && <GuideApp creds={creds} data={data} onNewData={onNewData} />}
          {a.id === "preview" && <PreviewApp creds={creds} />}
        </WindowFrame>
      ))}

      {startOpen && (
        <div className="start-menu" onClick={(e) => e.stopPropagation()}>
          <div className="start-head">Trellis Desktop</div>
          {visibleApps.map((a) => (
            <button key={a.id} className="start-item" onClick={() => openApp(a.id)}>
              <span aria-hidden="true">{a.icon}</span> {a.title}
            </button>
          ))}
          <div className="start-foot">Signed in as learner · everything here is your private lab</div>
        </div>
      )}

      <nav className="taskbar" aria-label="Taskbar" onClick={(e) => e.stopPropagation()}>
        <button className={`start-btn${startOpen ? " active" : ""}`} onClick={() => setStartOpen((s) => !s)} aria-label="Start">
          ⊞
        </button>
        {visibleApps.map((a) => {
          const w = windows[a.id];
          return (
            <button
              key={a.id}
              className={`task-btn${w.open ? " running" : ""}${w.open && !w.minimized ? " focused" : ""}`}
              onClick={() => taskbarClick(a.id)}
              title={a.title}
            >
              <span aria-hidden="true">{a.icon}</span>
              <span className="task-label">{a.title}</span>
            </button>
          );
        })}
        <div className="task-spacer" />
        <span className="task-brand">⌗ Trellis</span>
        <div className="task-clock" aria-label="Clock">
          <div>{fmtClock}</div>
          <div>{fmtDate}</div>
        </div>
      </nav>

      <InterventionToast creds={creds} />
    </div>
  );
}
