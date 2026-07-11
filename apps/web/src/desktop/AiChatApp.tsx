/**
 * AiChatApp — the simulated workplace AI assistant for workspace labs.
 *
 * This is LESSON CONTENT, not the instructor: a deliberately imperfect,
 * deterministic drafting tool that only knows what the learner shares.
 * The context box is the heart of the lesson — sharing is an explicit,
 * reviewable act. Text staged from Mail lands here EDITABLE, so trimming
 * out what the helper doesn't need is a natural, visible decision.
 */
import { useEffect, useRef, useState } from "react";
import { api, type SessionCredentials, type WorkspaceView } from "../api.ts";

export function AiChatApp({
  creds,
  view,
  onView,
  stagedContext,
  onStagedConsumed,
}: {
  creds: SessionCredentials;
  view: WorkspaceView;
  onView: (v: WorkspaceView) => void;
  /** Text staged from another app (Mail); appended to the context box. */
  stagedContext: string | null;
  onStagedConsumed: () => void;
}) {
  const [context, setContext] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (stagedContext !== null) {
      setContext((c) => (c.trim() ? c + "\n\n" + stagedContext : stagedContext));
      onStagedConsumed();
    }
  }, [stagedContext, onStagedConsumed]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [view.aiChat.thread.length]);

  const send = async () => {
    if (busy || (!prompt.trim() && !context.trim())) return;
    setBusy(true);
    try {
      onView(await api.workspaceAction(creds, { type: "chat-send", prompt, context }));
      setPrompt("");
      setContext(""); // shared context is now part of the conversation
    } finally {
      setBusy(false);
    }
  };

  const useDraft = async (draftId: string) => {
    onView(await api.workspaceAction(creds, { type: "insert-draft", draftId }));
  };

  return (
    <div className="aichat">
      <div className="sim-banner" role="note">
        {view.aiChat.tagline}
      </div>
      <div className="aichat-thread" ref={threadRef}>
        {view.aiChat.thread.length === 0 && (
          <div className="aichat-empty">
            <h3>{view.aiChat.assistantName}</h3>
            <p>I can draft or rewrite text for you — but I only know what you put in the context box below.</p>
            <p>Share the facts I need (and nothing more), tell me what you want, and I'll take a swing at it.</p>
          </div>
        )}
        {view.aiChat.thread.map((m) => (
          <div key={m.id} className={`aichat-row ${m.role}`}>
            <div className={`aichat-bubble ${m.role}`}>
              {m.role === "learner" && (m.contextChars ?? 0) > 0 && (
                <div className="aichat-ctx-tag">shared {m.contextChars} characters of context</div>
              )}
              <pre>{m.text}</pre>
              {m.draftId && (
                <button className="chip" onClick={() => void useDraft(m.draftId!)}>
                  ⤴ Use in reply (you can still edit it)
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="aichat-composer">
        <label className="aichat-ctx-label">
          Context to share — {view.aiChat.assistantName} will see exactly this, nothing else:
          <textarea
            className="aichat-ctx"
            value={context}
            placeholder="Nothing staged. Paste or type the facts the helper needs — or use “Send text to AI Helper” in Mail, then trim it here."
            onChange={(e) => setContext(e.target.value)}
          />
        </label>
        <div className="aichat-prompt-row">
          <textarea
            className="aichat-prompt"
            value={prompt}
            rows={2}
            placeholder={`Ask ${view.aiChat.assistantName} for what you need…`}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button className="chip chip-primary" disabled={busy || (!prompt.trim() && !context.trim())} onClick={() => void send()}>
            {busy ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
