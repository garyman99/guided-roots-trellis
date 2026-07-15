/**
 * Code Studio — the desktop experience's VS Code-style app.
 *
 *   left    activity strip + file explorer (real workspace files, via the
 *           session fs API — served from inside the lab environment)
 *   center  tabbed editor: a real Monaco (VS Code's engine) instance with
 *           live TS/JS diagnostics and lab-aware IntelliSense, dirty-dot
 *           tabs, Ctrl+S saves through the platform (measured)
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
import { monaco, THEME } from "./monacoSetup.ts";

interface OpenFile {
  path: string;
  content: string;
  savedContent: string;
  truncated: boolean;
}

/** Maps a workspace path to the Monaco language id used for its model. */
function languageForPath(path: string): string {
  if (/\.tsx?$/.test(path)) return "typescript";
  if (/\.(js|jsx|mjs|cjs)$/.test(path)) return "javascript";
  if (/\.json$/.test(path)) return "json";
  if (/\.md$/.test(path)) return "markdown";
  if (/\.(html|htm)$/.test(path)) return "html";
  if (/\.css$/.test(path)) return "css";
  return "plaintext";
}

/** Same extensions the server's lint service will actually lint — checked
 *  client-side too so plain files never fire a debounce timer for nothing. */
const LINTABLE = /\.(mjs|cjs|jsx?|tsx?)$/;
const LINT_DEBOUNCE_MS = 800;

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

  // Monaco lives outside React's render cycle: one host div, one editor
  // instance, one model per open file (keyed by path). `openFilesRef` gives
  // the model-creation path access to the latest openFiles without making
  // every keystroke re-run the active-file effect.
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelsRef = useRef(new Map<string, monaco.editor.ITextModel>());
  const openFilesRef = useRef<OpenFile[]>(openFiles);
  openFilesRef.current = openFiles;

  // Debounced server-side lint (type-aware ESLint — see apps/api/src/lint.ts):
  // one pending timer and one "latest request" sequence number per open
  // file, so a fast typist's earlier in-flight response can never clobber
  // the markers a later keystroke's response should set.
  const lintTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lintSeqRef = useRef(new Map<string, number>());

  const runLint = useCallback(
    (path: string, model: monaco.editor.ITextModel) => {
      const seq = (lintSeqRef.current.get(path) ?? 0) + 1;
      lintSeqRef.current.set(path, seq);
      api
        .lint(creds, path, model.getValue())
        .then((r) => {
          // Stale if a newer request has since gone out, or this model was
          // disposed/replaced (tab closed and reopened) while we waited.
          if (lintSeqRef.current.get(path) !== seq || modelsRef.current.get(path) !== model) return;
          monaco.editor.setModelMarkers(
            model,
            "eslint",
            r.messages.map((m) => ({
              startLineNumber: m.line,
              startColumn: m.column,
              endLineNumber: m.endLine,
              endColumn: m.endColumn,
              message: m.ruleId ? `${m.message} (${m.ruleId})` : m.message,
              severity: m.severity === 2 ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
            })),
          );
        })
        .catch(() => {
          // Best-effort: a lint hiccup leaves the previous markers in place
          // rather than clearing information the learner was already seeing.
        });
    },
    [creds],
  );

  const scheduleLint = useCallback(
    (path: string, model: monaco.editor.ITextModel) => {
      const existing = lintTimersRef.current.get(path);
      if (existing) clearTimeout(existing);
      if (!LINTABLE.test(path)) {
        // Not a lintable file (or e.g. a truncated/read-only guard upstream) —
        // make sure no stale squiggles linger from a previous file at this path.
        monaco.editor.setModelMarkers(model, "eslint", []);
        return;
      }
      lintTimersRef.current.set(
        path,
        setTimeout(() => {
          lintTimersRef.current.delete(path);
          runLint(path, model);
        }, LINT_DEBOUNCE_MS),
      );
    },
    [runLint],
  );

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
    const model = modelsRef.current.get(path);
    if (model) {
      model.dispose();
      modelsRef.current.delete(path);
    }
    const timer = lintTimersRef.current.get(path);
    if (timer) {
      clearTimeout(timer);
      lintTimersRef.current.delete(path);
    }
    lintSeqRef.current.delete(path);
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
    // Read straight from the live model so Ctrl+S always saves what's on
    // screen, not a possibly-lagging React state snapshot.
    const model = active ? modelsRef.current.get(active) : undefined;
    const content = model ? model.getValue() : f.content;
    if (content === f.savedContent) {
      setStatus("No changes to save");
      return;
    }
    try {
      await api.fsWrite(creds, f.path, content);
      setOpenFiles((fs) => fs.map((x) => (x.path === f.path ? { ...x, content, savedContent: content } : x)));
      setStatus(`Saved ${f.path} ✓`);
    } catch {
      setStatus(`Couldn't save ${f.path}`);
    }
  }, [openFiles, active, creds]);

  // Ctrl/Cmd+S is bound to the editor once at creation time; the command
  // closes over `saveRef` so it always invokes the current `save`.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  // Create the editor once and dispose it (and every model) on unmount.
  useEffect(() => {
    if (!hostRef.current) return;
    const editor = monaco.editor.create(hostRef.current, {
      theme: THEME,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      scrollBeyondLastLine: false,
      tabSize: 2,
    });
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveRef.current());
    return () => {
      editor.dispose();
      editorRef.current = null;
      modelsRef.current.forEach((model) => model.dispose());
      modelsRef.current.clear();
      lintTimersRef.current.forEach((t) => clearTimeout(t));
      lintTimersRef.current.clear();
    };
  }, []);

  // Keep the editor's model in sync with the active tab: lazily create a
  // model per file (seeded from openFiles content), then point the editor
  // at it and match its read-only state to `truncated`.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (!active) {
      editor.setModel(null);
      return;
    }
    let model = modelsRef.current.get(active);
    if (!model) {
      const file = openFilesRef.current.find((f) => f.path === active);
      if (!file) return;
      model = monaco.editor.createModel(file.content, languageForPath(active), monaco.Uri.file(active));
      modelsRef.current.set(active, model);
      const createdModel = model;
      const path = active;
      createdModel.onDidChangeContent(() => {
        const value = createdModel.getValue();
        setOpenFiles((fs) => fs.map((x) => (x.path === path ? { ...x, content: value } : x)));
        if (!file.truncated) scheduleLint(path, createdModel);
      });
      // Lint once up front too, so squiggles are there before the first edit
      // (truncated/read-only files are never sent — they're not real editable content).
      if (!file.truncated) scheduleLint(path, createdModel);
    }
    editor.setModel(model);
    const file = openFilesRef.current.find((f) => f.path === active);
    editor.updateOptions({ readOnly: file?.truncated ?? false });
  }, [active]);

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
            <div className={`cs-monaco${current ? "" : " cs-monaco-hidden"}`} ref={hostRef} />
            {!current && (
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
