/**
 * The learner terminal. xterm.js over the session WebSocket.
 *
 * ⚠ UNVERIFIED IN BUILD SANDBOX (no npm/browser there) — the protocol it
 * speaks (text frames = keystrokes, binary frames = JSON control messages,
 * scrollback replay on connect) is fully covered by apps/api/test/e2e.test.ts
 * using Node's WebSocket client.
 */
import { useEffect, useRef } from "react";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { terminalUrl, type SessionCredentials } from "./api.ts";

export function Terminal({ creds }: { creds: SessionCredentials }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Xterm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
      theme: {
        background: "#0c1014",
        foreground: "#dbe4ec",
        cursor: "#7fb069",
        selectionBackground: "#2c3b33",
      },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

    let ws: WebSocket | null = null;
    let closedByUs = false;
    let reconnectTimer: number | undefined;

    // Streaming decode: terminal output arrives as binary Buffer frames; a
    // persistent decoder handles multi-byte UTF-8 that splits across frames.
    const decoder = new TextDecoder();

    // Terminal output goes straight to xterm. Resize is a SERVER-SIDE pty
    // ioctl now (sessions.ts resizePty — TIOCSWINSZ, nothing typed into the
    // shell), so there is no `stty` echo to hide. The old echo-swallowing
    // filter held the last chunk waiting for that echo; when the prompt was
    // the final output (nothing followed to flush it), it stayed buffered and
    // the terminal rendered BLANK. (The dev-only local driver still types a
    // resize line — its one brief ` stty cols…` echo is acceptable.)
    const writeChunk = (chunk: string) => term.write(chunk);

    const sendResize = () => {
      if (ws?.readyState === WebSocket.OPEN) {
        // Binary frame = control channel (see server.ts).
        ws.send(new TextEncoder().encode(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows })));
      }
    };

    const connect = () => {
      ws = new WebSocket(terminalUrl(creds));
      ws.binaryType = "arraybuffer";
      ws.onopen = () => sendResize(); // server replays scrollback by itself
      ws.onmessage = (ev) => {
        writeChunk(
          typeof ev.data === "string"
            ? ev.data
            : decoder.decode(new Uint8Array(ev.data as ArrayBuffer), { stream: true }),
        );
      };
      ws.onclose = () => {
        if (closedByUs) return;
        term.write("\r\n\x1b[33m— connection lost, reconnecting… —\x1b[0m\r\n");
        reconnectTimer = window.setTimeout(connect, 1500);
      };
    };
    connect();

    const dataSub = term.onData((data) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(data);
    });

    // Input-compat shim for the insertText path (IMEs, voice input,
    // assistive/remote-control tools). Measured in Chromium (live-sim probe,
    // 2026-07-12): a newline-bearing insert splits into an `input` event
    // carrying the text — which xterm consumes — plus a second `input` event
    // with data:null for the line break, which xterm ignores (its guard
    // needs truthy data); virtual keyboards fire inputType insertLineBreak
    // the same way. The line break is lost AND the un-cleared textarea value
    // then poisons every later insert, so the terminal looks dead. Deliver
    // the missing Enter ourselves and never let residue accumulate. IME
    // composition is untouched (xterm's CompositionHelper owns it).
    const helper = host.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");
    let composing = false;
    const onCompStart = () => { composing = true; };
    const onCompEnd = () => { composing = false; };
    const onHelperInput = (e: Event) => {
      const ev = e as InputEvent;
      if (composing || ev.isComposing) return;
      const lineBreak =
        ev.inputType === "insertLineBreak" || (ev.inputType === "insertText" && ev.data === null);
      if (lineBreak) term.input("\r", true); // Enter reaches a pty as CR
      // Clear residue after the event burst settles; xterm reads ev.data,
      // never the accumulated value (outside composition).
      window.setTimeout(() => {
        if (!composing && helper) helper.value = "";
      }, 0);
    };
    helper?.addEventListener("compositionstart", onCompStart);
    helper?.addEventListener("compositionend", onCompEnd);
    helper?.addEventListener("input", onHelperInput);

    // Debounced fit-and-resize: only after the drag settles, because each
    // pty resize echoes a control line in the terminal.
    let debounce: number | undefined;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        fit.fit();
        sendResize();
      }, 400);
    });
    observer.observe(host);

    return () => {
      closedByUs = true;
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(debounce);
      helper?.removeEventListener("compositionstart", onCompStart);
      helper?.removeEventListener("compositionend", onCompEnd);
      helper?.removeEventListener("input", onHelperInput);
      observer.disconnect();
      dataSub.dispose();
      ws?.close();
      term.dispose();
    };
  }, [creds.sessionId, creds.token]);

  return <div className="terminal-host" ref={hostRef} aria-label="Lab terminal" />;
}
