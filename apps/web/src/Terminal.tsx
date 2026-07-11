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
        term.write(typeof ev.data === "string" ? ev.data : new Uint8Array(ev.data as ArrayBuffer));
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
      observer.disconnect();
      dataSub.dispose();
      ws?.close();
      term.dispose();
    };
  }, [creds.sessionId, creds.token]);

  return <div className="terminal-host" ref={hostRef} aria-label="Lab terminal" />;
}
