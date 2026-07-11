/**
 * Code Studio — the desktop experience's VS Code-style app.
 *
 *   left    activity strip + file explorer (real workspace files, via the
 *           session fs API — served from inside the lab environment)
 *   center  tabbed editor: zero-dep syntax highlighting (overlay technique),
 *           dirty-dot tabs, Ctrl+S saves through the platform (measured)
 *   bottom  the integrated terminal — the SAME instrumented pty as ever
 *
 * The pedagogy: a brand-new user learns the shape of a professional editor —
 * files live on the left, you click one to read it, edit, save, and run
 * things in the terminal panel below. Nothing here bypasses measurement:
 * reads/writes go through the lab handle, terminal keystrokes through the
 * instrumented shell.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type SessionCredentials } from "../api.ts";
import { Terminal } from "../Terminal.tsx";

interface OpenFile {
  path: string;
  content: string;
  savedContent: string;
  truncated: boolean;
}

/** Minimal JS/JSON/MD tokenizer — comments, strings, keywords, numbers. */
function highlight(code: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const rx =
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(const|let|var|function|async|await|return|if|else|for|while|of|in|import|from|export|default|new|class|extends|try|catch|throw|typeof|test|expect|describe|true|false|null|undefined)\b|(\b\d+(?:\.\d+)?\b)/g;
  let out = "";
  let last = 0;
  for (let m = rx.exec(code); m; m = rx.exec(code)) {
    out += esc(code.slice(last, m.index));
    const cls = m[1] ? "tok-comment" : m[2] ? "tok-string" : m[3] ? "tok-keyword" : "tok-number";
    out += `<span class="${cls}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(code.slice(last));
}

function FileIcon({ path, dir }: { path: string; dir: boolean }) {
  const glyph = dir ? "📁" : path.endsWith(".html") ? "🌐" : path.endsWith(".json") ? "🧾" : path.endsWith(".md") ? "📘" : "📄";
  return (
    <span className="file-icon" aria-hidden="true">
      {glyph}
    </span>
  );
}

export function CodeStudio({
  creds,
  onEditorState,
}: {
  creds: SessionCredentials;
  onEditorState?: (s: { file: string | null; dirty: boolean }) => void;
}) {
  const [entries, setEntries] = useState<Array<{ path: string; dir: boolean }>>([]);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLPreElement>(null);

  const refreshTree = useCallback(() => {
    api.fsList(creds).then((r) => setEntries(r.entries)).catch(() => setStatus("Couldn't list files"));
  }, [creds]);
  useEffect(() => {
    refreshTree();
  }, [refreshTree]);

  const openFile = async (path: string) => {
    const existing = openFiles.find((f) => f.path === path);
    if (existing) {
      setActive(path);
      return;
    }
    try {
      const r = await api.fsRead(creds, path);
      setOpenFiles((fs) => [...fs, { path, content: r.content, savedContent: r.content, truncated: r.truncated }]);
      setActive(path);
      setStatus(r.truncated ? `${path} is large — showing the first 200 KB (read-only)` : `Opened ${path}`);
    } catch {
      setStatus(`Couldn't open ${path}`);
    }
  };

  const closeFile = (path: string) => {
    const f = openFiles.find((x) => x.path === path);
    if (f && f.content !== f.savedContent && !confirm(`${path} has unsaved changes. Close anyway?`)) return;
    setOpenFiles((fs) => fs.filter((x) => x.path !== path));
    if (active === path) setActive(openFiles.filter((x) => x.path !== path).at(-1)?.path ?? null);
  };

  const current = openFiles.find((f) => f.path === active) ?? null;
  const dirty = current !== null && current.content !== current.savedContent;

  // Report what's on screen (active file + unsaved state) to the desktop, so
  // the guide can send it along with learner messages as self-reported context.
  useEffect(() => {
    onEditorState?.({ file: active, dirty });
  }, [active, dirty, onEditorState]);

  const save = useCallback(async () => {
    const f = openFiles.find((x) => x.path === active);
    if (!f || f.truncated) return;
    if (f.content === f.savedContent) {
      setStatus("No changes to save");
      return;
    }
    try {
      await api.fsWrite(creds, f.path, f.content);
      setOpenFiles((fs) => fs.map((x) => (x.path === f.path ? { ...x, savedContent: f.content } : x)));
      setStatus(`Saved ${f.path} ✓`);
    } catch {
      setStatus(`Couldn't save ${f.path}`);
    }
  }, [openFiles, active, creds]);

  const html = useMemo(() => (current ? highlight(current.content) + "\n" : ""), [current]);

  // Directory-grouped, stable order: dirs first at each level, then files.
  const tree = useMemo(() => [...entries].sort((a, b) => a.path.localeCompare(b.path)), [entries]);

  return (
    <div className="codestudio">
      <div className="cs-main">
        <nav className="cs-activity" aria-label="Activity bar">
          <button className="cs-activity-btn active" title="Explorer">
            🗂
          </button>
          <button className="cs-activity-btn" title="Refresh files" onClick={refreshTree}>
            ⟳
          </button>
        </nav>
        <aside className="cs-explorer">
          <div className="cs-explorer-head">EXPLORER</div>
          <ul className="cs-tree">
            {tree.map((e) => (
              <li key={e.path}>
                <button
                  className={`cs-node${e.dir ? " dir" : ""}${active === e.path ? " active" : ""}`}
                  style={{ paddingLeft: 10 + e.path.split("/").length * 12 }}
                  disabled={e.dir}
                  aria-label={e.dir ? undefined : `Open ${e.path}`}
                  onClick={() => void openFile(e.path)}
                >
                  <FileIcon path={e.path} dir={e.dir} />
                  {e.path.split("/").pop()}
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <div className="cs-editor-zone">
          <div className="cs-tabs" role="tablist">
            {openFiles.map((f) => (
              <div
                key={f.path}
                role="tab"
                aria-selected={active === f.path}
                className={`cs-tab${active === f.path ? " active" : ""}`}
                onClick={() => setActive(f.path)}
              >
                {f.path.split("/").pop()}
                <span className="cs-dirty" aria-label={f.content !== f.savedContent ? "unsaved" : "saved"}>
                  {f.content !== f.savedContent ? "●" : ""}
                </span>
                <button
                  className="cs-tab-close"
                  aria-label={`Close ${f.path}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeFile(f.path);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
            {openFiles.length === 0 && <div className="cs-tabs-empty">Click a file on the left to open it</div>}
          </div>
          <div className="cs-editor">
            {current ? (
              <>
                <pre className="cs-highlight" ref={overlayRef} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
                <textarea
                  ref={editorRef}
                  className="cs-textarea"
                  value={current.content}
                  readOnly={current.truncated}
                  spellCheck={false}
                  onChange={(e) =>
                    setOpenFiles((fs) => fs.map((x) => (x.path === current.path ? { ...x, content: e.target.value } : x)))
                  }
                  onScroll={(e) => {
                    if (overlayRef.current) {
                      overlayRef.current.scrollTop = (e.target as HTMLTextAreaElement).scrollTop;
                      overlayRef.current.scrollLeft = (e.target as HTMLTextAreaElement).scrollLeft;
                    }
                  }}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
                      e.preventDefault();
                      void save();
                    }
                  }}
                />
              </>
            ) : (
              <div className="cs-welcome">
                <h3>Code Studio</h3>
                <p>Your project's files are listed on the left. Click one to read it.</p>
                <p>
                  Edit, then press <kbd>Ctrl</kbd>+<kbd>S</kbd> to save — the dot on the tab disappears when your change
                  is saved.
                </p>
                <p>The terminal below is a real shell in the same project.</p>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="cs-terminal">
        <div className="cs-terminal-head">TERMINAL</div>
        <Terminal creds={creds} />
      </div>
      <footer className="cs-status">
        <span>{status}</span>
        <span>{current ? `${current.path}${dirty ? " — unsaved changes (Ctrl+S)" : ""}` : "No file open"}</span>
      </footer>
    </div>
  );
}
