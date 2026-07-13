import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { postJson, TransportError, type TransportLogEntry } from "../src/transport.ts";

type Handler = (req: { url: string; headers: Record<string, string | string[] | undefined>; body: string }, respond: (status: number, body: string, delayMs?: number) => void) => void;

async function withServer(handler: Handler, fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      handler({ url: req.url ?? "", headers: req.headers, body }, (status, out, delayMs = 0) => {
        setTimeout(() => res.writeHead(status, { "content-type": "application/json" }).end(out), delayMs);
      });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test("postJson: success round-trip with request id header", async () => {
  await withServer(
    (req, respond) => {
      assert.equal(req.headers["x-trellis-request-id"], "req-1");
      assert.equal(JSON.parse(req.body).hello, "world");
      respond(200, JSON.stringify({ ok: true }));
    },
    async (baseUrl) => {
      const res = await postJson<{ ok: boolean }>({ url: `${baseUrl}/x`, body: { hello: "world" }, requestId: "req-1" });
      assert.equal(res.json.ok, true);
      assert.equal(res.attempts, 1);
      assert.equal(res.requestId, "req-1");
    },
  );
});

test("postJson: retries 500 then succeeds; log entries carry no bodies", async () => {
  let calls = 0;
  const log: TransportLogEntry[] = [];
  await withServer(
    (_req, respond) => {
      calls += 1;
      if (calls < 3) respond(500, JSON.stringify({ err: "boom" }));
      else respond(200, JSON.stringify({ ok: true }));
    },
    async (baseUrl) => {
      const res = await postJson({ url: `${baseUrl}/x`, body: { secret: "s3cret" }, retryDelayMs: 1, log: (e) => log.push(e) });
      assert.equal(res.attempts, 3);
      assert.equal(log.length, 3);
      assert.equal(log[0].category, "server_error");
      assert.equal(log[2].status, 200);
      assert.ok(!JSON.stringify(log).includes("s3cret"), "safe logging: bodies never reach log entries");
    },
  );
  assert.equal(calls, 3);
});

test("postJson: 429 is retried and surfaces rate_limited after budget", async () => {
  let calls = 0;
  await withServer(
    (_req, respond) => {
      calls += 1;
      respond(429, JSON.stringify({ err: "slow down" }));
    },
    async (baseUrl) => {
      await assert.rejects(
        postJson({ url: `${baseUrl}/x`, body: {}, retryDelayMs: 1, maxRetries: 2 }),
        (err: TransportError) => err.category === "rate_limited" && err.attempts === 3 && err.status === 429,
      );
    },
  );
  assert.equal(calls, 3);
});

test("postJson: 400 is NOT retried and keeps a body snippet", async () => {
  let calls = 0;
  await withServer(
    (_req, respond) => {
      calls += 1;
      respond(400, JSON.stringify({ error: { message: "bad model id" } }));
    },
    async (baseUrl) => {
      await assert.rejects(
        postJson({ url: `${baseUrl}/x`, body: {}, retryDelayMs: 1 }),
        (err: TransportError) =>
          err.category === "bad_request" && err.attempts === 1 && (err.bodySnippet ?? "").includes("bad model id"),
      );
    },
  );
  assert.equal(calls, 1);
});

test("postJson: 401 maps to auth and is not retried", async () => {
  await withServer(
    (_req, respond) => respond(401, "{}"),
    async (baseUrl) => {
      await assert.rejects(
        postJson({ url: `${baseUrl}/x`, body: {}, retryDelayMs: 1 }),
        (err: TransportError) => err.category === "auth" && err.attempts === 1,
      );
    },
  );
});

test("postJson: per-attempt timeout aborts with category timeout, no retry", async () => {
  await withServer(
    (_req, respond) => respond(200, "{}", 5_000),
    async (baseUrl) => {
      const started = Date.now();
      await assert.rejects(
        postJson({ url: `${baseUrl}/x`, body: {}, timeoutMs: 100, retryDelayMs: 1 }),
        (err: TransportError) => err.category === "timeout" && err.attempts === 1,
      );
      assert.ok(Date.now() - started < 3_000, "did not wait for the slow body");
    },
  );
});

test("postJson: connection refused retries then surfaces network", async () => {
  // Grab a port that is definitely closed by binding and releasing it.
  const server = createServer(() => {});
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  await new Promise((r) => server.close(r));
  await assert.rejects(
    postJson({ url: `http://127.0.0.1:${port}/x`, body: {}, retryDelayMs: 1, maxRetries: 1 }),
    (err: TransportError) => err.category === "network" && err.attempts === 2,
  );
});

test("postJson: unparseable 2xx surfaces bad_response", async () => {
  await withServer(
    (_req, respond) => respond(200, "definitely not json"),
    async (baseUrl) => {
      await assert.rejects(
        postJson({ url: `${baseUrl}/x`, body: {} }),
        (err: TransportError) => err.category === "bad_response" && (err.bodySnippet ?? "").startsWith("definitely"),
      );
    },
  );
});
