/**
 * EmailApp — the simulated mail client for workspace labs.
 *
 * Everything here is visibly practice: the send button says "Send simulated
 * reply", a banner marks the space, and nothing leaves the session. The one
 * bridge to the AI helper is EXPLICIT: "Send text to AI Helper" stages the
 * message body into the helper's editable context box — the learner decides
 * what actually gets shared (and can trim it there first).
 */
import { useState } from "react";
import { api, type SessionCredentials, type WorkspaceView } from "../api.ts";

export function EmailApp({
  creds,
  view,
  onView,
  onStageContext,
}: {
  creds: SessionCredentials;
  view: WorkspaceView;
  onView: (v: WorkspaceView) => void;
  onStageContext: (text: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState(view.reply.text);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const message = view.email.inbox.find((m) => m.id === openId) ?? null;
  const replyTarget = view.email.inbox.find((m) => m.id === view.email.replyTo);
  const submitted = view.reply.submitted;

  // The server holds reply truth; local `draft` is the editing buffer. When a
  // draft was inserted from the helper, adopt it (unless mid-local-edit).
  if (view.reply.text !== "" && draft === "" && view.reply.text !== draft) {
    setDraft(view.reply.text);
  }

  const act = async (action: Parameters<typeof api.workspaceAction>[1]) => {
    onView(await api.workspaceAction(creds, action));
  };

  const openMessage = (id: string) => {
    setOpenId(id);
    void act({ type: "open-artifact", appId: "email", artifactId: id });
  };

  const saveDraft = async () => {
    await act({ type: "update-draft", text: draft });
    setSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  };

  const send = async () => {
    // Unsaved edits ride along with the send — what you see is what you send.
    if (draft !== view.reply.text) await act({ type: "update-draft", text: draft });
    await act({ type: "submit-reply" });
    setConfirmSend(false);
  };

  return (
    <div className="mailapp">
      <div className="sim-banner" role="note">
        Practice space — messages here are simulated and never reach a real person.
      </div>
      <div className="mail-columns">
        <aside className="mail-list">
          <div className="mail-list-head">Inbox</div>
          <ul>
            {view.email.inbox.map((m) => (
              <li key={m.id}>
                <button
                  className={`mail-item${openId === m.id ? " active" : ""}${m.read ? "" : " unread"}`}
                  onClick={() => openMessage(m.id)}
                >
                  <span className="mail-from">{m.from.replace(/<.*>/, "").trim()}</span>
                  <span className="mail-subject">{m.subject}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mail-list-head">Team notes</div>
          <ul>
            {view.email.notes.map((n) => (
              <li key={n.id}>
                <button className={`mail-item note${openId === n.id ? " active" : ""}`} onClick={() => openMessage(n.id)}>
                  <span className="mail-subject">📌 {n.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="mail-reading">
          {message ? (
            <>
              <div className="mail-msg-head">
                <div className="mail-msg-subject">{message.subject}</div>
                <div className="mail-msg-from">{message.from}</div>
              </div>
              <pre className="mail-msg-body">{message.body}</pre>
              <div className="mail-msg-actions">
                <button className="chip" onClick={() => onStageContext(message.body)}>
                  ✨ Send text to AI Helper
                </button>
                <span className="mail-hint">— it lands in an editable box over there; trim it before sharing.</span>
              </div>
            </>
          ) : (() => {
            const note = view.email.notes.find((n) => n.id === openId);
            return note ? (
              <>
                <div className="mail-msg-head">
                  <div className="mail-msg-subject">📌 {note.title}</div>
                </div>
                <pre className="mail-msg-body">{note.body}</pre>
              </>
            ) : (
              <div className="mail-empty">Select a message on the left to read it.</div>
            );
          })()}
        </section>
      </div>

      <section className="mail-compose">
        <div className="mail-compose-head">
          Reply to: {replyTarget ? replyTarget.from : "—"}
          {submitted && <span className="mail-sent-tag">✓ simulated reply sent</span>}
        </div>
        <textarea
          className="mail-compose-body"
          value={draft}
          placeholder="Write your reply here — or bring a draft over from the AI Helper and make it yours."
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void saveDraft()}
        />
        <div className="mail-compose-actions">
          <span className="mail-hint">{savedAt ? `Draft saved ${savedAt}` : view.reply.hasAiBaseline ? "This started as an AI draft — make it yours." : ""}</span>
          <button className="chip" disabled={!draft.trim()} onClick={() => void saveDraft()}>
            Save draft
          </button>
          {confirmSend ? (
            <span className="mail-confirm">
              Send the simulated reply?
              <button className="chip chip-primary" onClick={() => void send()}>Yes, send (simulated)</button>
              <button className="chip" onClick={() => setConfirmSend(false)}>Not yet</button>
            </span>
          ) : (
            <button className="chip chip-primary" disabled={!draft.trim()} onClick={() => setConfirmSend(true)}>
              {submitted ? "Resend simulated reply" : "Send simulated reply"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
