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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./desktop.css";
import { api, type ScreenReport, type SessionCredentials, type StatePayload, type WorkspaceView } from "../api.ts";
import { isAuthenticated } from "../auth.ts";
import { CodeStudio } from "./CodeStudio.tsx";
import { ChatGuide } from "./ChatGuide.tsx";
import { EmailApp } from "./EmailApp.tsx";
import { AiChatApp } from "./AiChatApp.tsx";
import { WindowFrame, type OsStyle, type WindowState } from "./WindowFrame.tsx";

type AppId = string; // "guide" | "code" | "preview" | workspace app ids ("email", "ai-chat", …)

interface AppSpec {
  id: AppId;
  title: string;
  icon: string;
  initial: (i: number) => WindowState;
}

const win = (open: boolean, rect: { x: number; y: number; w: number; h: number }, z = 1): WindowState => ({
  open,
  minimized: false,
  maximized: false,
  rect,
  z,
});

// Goal-first onboarding: a fresh session shows ONE thing — the guide,
// centered — asking what the learner wants to accomplish. Everything else
// is opened BY the learner from the desktop, guided step by step.
const GUIDE: AppSpec = {
  id: "guide",
  title: "Trellis Guide",
  icon: "🌿",
  initial: () => {
    const w = Math.min(460, window.innerWidth - 48);
    const h = Math.min(560, window.innerHeight - 120);
    return win(true, { x: Math.max(16, (window.innerWidth - w) / 2), y: Math.max(20, (window.innerHeight - h) / 2 - 24), w, h }, 2);
  },
};

/** Terminal labs: the classic desktop — Code Studio, guide, site preview. */
const TERMINAL_APPS: AppSpec[] = [
  {
    id: "code",
    title: "Code Studio",
    icon: "🧩",
    initial: () => win(false, { x: 60, y: 40, w: Math.min(1020, window.innerWidth - 480), h: window.innerHeight - 160 }),
  },
  GUIDE,
  {
    id: "preview",
    title: "Garden Site",
    icon: "🌐",
    initial: () => win(false, { x: 140, y: 90, w: 640, h: 560 }),
  },
];

/** Workspace labs: apps come from the lab manifest. They start CLOSED —
 * finding and opening the right app is part of what the lesson teaches
 * (goal-first onboarding); the guide names the app, the learner opens it. */
function workspaceApps(declared: Array<{ id: string; title: string; icon: string }>): AppSpec[] {
  const usable = Math.max(720, window.innerWidth - 440);
  const each = Math.min(560, Math.floor(usable / Math.max(1, declared.length)) - 16);
  return [
    ...declared.map((a, i) => ({
      id: a.id,
      title: a.title,
      icon: a.icon,
      initial: () => win(false, { x: 24 + i * (each + 14), y: 36, w: each, h: window.innerHeight - 150 }),
    })),
    GUIDE,
  ];
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
  // App set is lab-driven: workspace labs declare their simulated apps.
  const APPS = useMemo<AppSpec[]>(
    () => (data.lab.workspaceApps ? workspaceApps(data.lab.workspaceApps) : TERMINAL_APPS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [creds.sessionId],
  );
  const isWorkspaceLab = data.lab.workspaceApps !== null;

  const [windows, setWindows] = useState<Record<AppId, WindowState>>(() =>
    Object.fromEntries(APPS.map((a, i) => [a.id, a.initial(i)])) as Record<AppId, WindowState>,
  );

  // ── Workspace labs: shared app data + the Mail → AI Helper staging bridge ──
  const [wsView, setWsView] = useState<WorkspaceView | null>(null);
  const [stagedContext, setStagedContext] = useState<string | null>(null);
  useEffect(() => {
    if (!isWorkspaceLab) return;
    let stop = false;
    const tick = async () => {
      try {
        const v = await api.workspace(creds);
        if (!stop) setWsView(v);
      } catch {
        /* transient */
      }
    };
    void tick();
    const t = setInterval(tick, 2_500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [creds, isWorkspaceLab]);
  const stageContext = useCallback((text: string) => {
    setStagedContext(text);
    // Bring the helper forward so the learner SEES where the text landed.
    setWindows((w) =>
      w["ai-chat"] ? { ...w, "ai-chat": { ...w["ai-chat"], open: true, minimized: false, z: ++zRef.current } } : w,
    );
  }, []);
  // The editor reports what it's showing; the guide bot sends it along with
  // learner messages so the instructor can phrase against the actual screen.
  const editorState = useRef<{ file: string | null; dirty: boolean }>({ file: null, dirty: false });
  const windowsRef = useRef(windows);
  windowsRef.current = windows;
  const getScreen = (): ScreenReport => {
    const open = APPS.filter((a) => windowsRef.current[a.id]?.open && !windowsRef.current[a.id]?.minimized);
    const top = [...open].sort((a, b) => windowsRef.current[b.id].z - windowsRef.current[a.id].z)[0];
    return {
      activeApp: top?.title ?? null,
      openWindows: open.map((a) => a.title),
      editorFile: windowsRef.current.code?.open ? editorState.current.file : null,
      editorDirty: editorState.current.dirty,
    };
  };
  const [startOpen, setStartOpen] = useState(false);
  const [selectedIcon, setSelectedIcon] = useState<AppId | null>(null);
  const zRef = useRef(10);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // The preview app only exists for terminal labs that ship a static site.
  const [hasSite, setHasSite] = useState(false);
  useEffect(() => {
    if (isWorkspaceLab) return; // no lab filesystem to probe
    api.fsRead(creds, "app/index.html").then(() => setHasSite(true)).catch(() => setHasSite(false));
  }, [creds, isWorkspaceLab]);
  const visibleApps = useMemo(() => APPS.filter((a) => a.id !== "preview" || hasSite), [APPS, hasSite]);

  const update = (id: AppId, next: Partial<WindowState>) =>
    setWindows((w) => ({ ...w, [id]: { ...w[id], ...next } }));
  const focusWin = (id: AppId) => update(id, { z: ++zRef.current });
  const openApp = (id: AppId) => {
    setStartOpen(false);
    setSelectedIcon(null);
    update(id, { open: true, minimized: false, z: ++zRef.current });
    // Workspace apps: opening is a measured, semantic act.
    if (isWorkspaceLab && id !== "guide") {
      api.workspaceAction(creds, { type: "open-app", appId: id }).then(setWsView).catch(() => {});
    }
  };
  // Fronting via the taskbar must also move real keyboard focus into the
  // window: z-order alone leaves DOM focus wherever it was (e.g. the
  // terminal's hidden textarea), which is how a learner's chat text ended up
  // on the prompt line (finding taskbar-click-minimizes-covered-window).
  const focusWindowDom = (id: AppId) => {
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`.window[data-app-id="${id}"]`);
      if (!el) return;
      const input = el.querySelector<HTMLElement>('textarea, input:not([type="hidden"]), [contenteditable="true"]');
      (input ?? el).focus();
    });
  };
  const frontWin = (id: AppId) => {
    update(id, { minimized: false, z: ++zRef.current });
    focusWindowDom(id);
  };
  const isTopWindow = (id: AppId) => {
    const visible = APPS.filter((a) => windows[a.id]?.open && !windows[a.id]?.minimized);
    return visible.length > 0 && visible.every((a) => a.id === id || windows[a.id].z < windows[id].z);
  };
  const taskbarClick = (id: AppId) => {
    const w = windows[id];
    if (!w.open) return openApp(id);
    // Windows taskbar semantics: only the focused (top) window minimizes on
    // click; a minimized or covered window comes to the front with focus.
    if (w.minimized || !isTopWindow(id)) return frontWin(id);
    update(id, { minimized: true });
  };

  const fmtClock = clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const fmtDate = clock.toLocaleDateString([], { month: "short", day: "numeric" });

  // Leaving is plain navigation: the session (and its shell) lives on
  // server-side, so coming back reattaches right where they left off.
  // Signed-in learners return to the launcher; the ungated tooling entry
  // ("/?lab=…", no auth user) falls back to the landing page.
  const leaveDesktop = () => window.location.assign(isAuthenticated() ? "/home" : "/");

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
          appId={a.id}
          title={a.id === "guide" ? `${a.title} — ${data.lab.title}` : a.title}
          icon={a.icon}
          state={windows[a.id]}
          onChange={(next) => update(a.id, next)}
          onFocus={() => focusWin(a.id)}
          onClose={() => update(a.id, { open: false })}
        >
          {a.id === "code" && <CodeStudio creds={creds} onEditorState={(s) => (editorState.current = s)} />}
          {a.id === "guide" && <ChatGuide creds={creds} data={data} onNewData={onNewData} getScreen={getScreen} />}
          {a.id === "preview" && <PreviewApp creds={creds} />}
          {a.id === "email" &&
            (wsView ? (
              <EmailApp creds={creds} view={wsView} onView={setWsView} onStageContext={stageContext} />
            ) : (
              <div className="ws-loading">Opening Mail…</div>
            ))}
          {a.id === "ai-chat" &&
            (wsView ? (
              <AiChatApp
                creds={creds}
                view={wsView}
                onView={setWsView}
                stagedContext={stagedContext}
                onStagedConsumed={() => setStagedContext(null)}
              />
            ) : (
              <div className="ws-loading">Opening the AI Helper…</div>
            ))}
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
          <button className="start-item start-leave" onClick={leaveDesktop}>
            <span aria-hidden="true">⏻</span> Leave the desktop
          </button>
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
        <button
          className="task-btn task-leave"
          onClick={leaveDesktop}
          title="Leave the desktop — your session keeps running, so you can come back"
        >
          <span aria-hidden="true">⏻</span>
          <span className="task-label">Leave</span>
        </button>
        <span className="task-brand">⌗ Trellis</span>
        <div className="task-clock" aria-label="Clock">
          <div>{fmtClock}</div>
          <div>{fmtDate}</div>
        </div>
      </nav>

      {/* Interventions surface IN the chat (ChatGuide) on the desktop —
          conversational check-ins with quick replies, not a toast. */}
    </div>
  );
}
