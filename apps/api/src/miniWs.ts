/**
 * miniWs — a minimal RFC 6455 WebSocket server.
 *
 * WHY THIS EXISTS: the POC is buildable offline with zero npm dependencies;
 * in a networked deployment you would swap this for the `ws` package behind
 * the same tiny interface. Scope deliberately covers only what the terminal
 * needs: text/binary frames ≤ ~1MB, server→client unmasked frames,
 * client→server masked frames (required by the RFC), ping/pong, close.
 * No extensions, no compression, no fragmentation reassembly beyond
 * sequential continuation frames.
 *
 * Verified in-sandbox against Node's built-in WebSocket client.
 */
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export interface WsConnection {
  send(data: string | Buffer): void;
  close(code?: number, reason?: string): void;
  onMessage(cb: (data: Buffer, isBinary: boolean) => void): void;
  onClose(cb: () => void): void;
}

export function acceptUpgrade(req: IncomingMessage, socket: Duplex): WsConnection | null {
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string" || (req.headers.upgrade ?? "").toLowerCase() !== "websocket") {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return null;
  }
  const accept = createHash("sha1").update(key + GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );

  let buffer = Buffer.alloc(0);
  let closed = false;
  const messageCbs: Array<(data: Buffer, isBinary: boolean) => void> = [];
  const closeCbs: Array<() => void> = [];
  let fragments: Buffer[] = [];
  let fragmentOpcode = 0;

  const doClose = () => {
    if (closed) return;
    closed = true;
    closeCbs.forEach((cb) => cb());
    socket.destroy();
  };

  const sendFrame = (opcode: number, payload: Buffer) => {
    if (closed || socket.destroyed) return;
    const len = payload.length;
    let header: Buffer;
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    socket.write(Buffer.concat([header, payload]));
  };

  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    // Parse as many complete frames as are buffered.
    for (;;) {
      if (buffer.length < 2) return;
      const fin = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let payloadLen = buffer[1] & 0x7f;
      let offset = 2;
      if (payloadLen === 126) {
        if (buffer.length < 4) return;
        payloadLen = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (buffer.length < 10) return;
        const big = buffer.readBigUInt64BE(2);
        if (big > 1_048_576n) return doClose(); // sanity cap: 1MB
        payloadLen = Number(big);
        offset = 10;
      }
      if (payloadLen > 1_048_576) return doClose();
      const maskLen = masked ? 4 : 0;
      if (buffer.length < offset + maskLen + payloadLen) return;

      let payload = buffer.subarray(offset + maskLen, offset + maskLen + payloadLen);
      if (masked) {
        const mask = buffer.subarray(offset, offset + 4);
        const unmasked = Buffer.allocUnsafe(payloadLen);
        for (let i = 0; i < payloadLen; i++) unmasked[i] = payload[i] ^ mask[i & 3];
        payload = unmasked;
      } else {
        // RFC 6455 §5.1: client frames MUST be masked.
        return doClose();
      }
      buffer = buffer.subarray(offset + maskLen + payloadLen);

      switch (opcode) {
        case 0x0: // continuation
          fragments.push(payload);
          if (fin) {
            const whole = Buffer.concat(fragments);
            const op = fragmentOpcode;
            fragments = [];
            fragmentOpcode = 0;
            messageCbs.forEach((cb) => cb(whole, op === 0x2));
          }
          break;
        case 0x1: // text
        case 0x2: // binary
          if (fin) {
            messageCbs.forEach((cb) => cb(payload, opcode === 0x2));
          } else {
            fragments = [payload];
            fragmentOpcode = opcode;
          }
          break;
        case 0x8: // close
          sendFrame(0x8, Buffer.alloc(0));
          doClose();
          return;
        case 0x9: // ping
          sendFrame(0xa, payload);
          break;
        case 0xa: // pong
          break;
        default:
          return doClose();
      }
    }
  });

  socket.on("close", doClose);
  socket.on("error", doClose);

  return {
    send: (data) => sendFrame(typeof data === "string" ? 0x1 : 0x2, Buffer.isBuffer(data) ? data : Buffer.from(data)),
    close: (code = 1000) => {
      const payload = Buffer.alloc(2);
      payload.writeUInt16BE(code);
      sendFrame(0x8, payload);
      doClose();
    },
    onMessage: (cb) => messageCbs.push(cb),
    onClose: (cb) => closeCbs.push(cb),
  };
}
