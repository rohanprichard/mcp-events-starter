import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Events, type Post } from "../src/events.js";
import { handleMcp } from "../src/mcp.js";
import { DemoBoard } from "../src/demo.js";
import { Store } from "../src/store.js";
import { sign } from "../src/signatures.js";

const secret = `whsec_${Buffer.alloc(32, 3).toString("base64")}`;
const delivery = { mode: "webhook", url: "http://localhost:4000/hook", secret };

test("verifies a callback, sends matching tasks, and unsubscribes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-events-"));
  try {
    const store = new Store(join(directory, "subscriptions.json"));
    const sent: { body: string; headers: Record<string, string> }[] = [];
    const post: Post = async (_url, body, headers) => {
      sent.push({ body, headers });
      const payload = JSON.parse(body);
      if (payload.type === "verification") return { status: 200, body: JSON.stringify({ challenge: payload.challenge }) };
      return { status: 204, body: "" };
    };
    const events = new Events(store, true, post, async () => ({ url: new URL(delivery.url), address: "127.0.0.1", localDemo: true }));
    const board = new DemoBoard(events);
    const params = { name: "task.created", arguments: { project_id: "demo" }, delivery };
    const first = await events.subscribe("demo", params);
    assert.equal(store.get(first.id)?.active, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].headers["webhook-signature"], sign(secret, sent[0].headers["webhook-id"], Number(sent[0].headers["webhook-timestamp"]), sent[0].body));
    const second = await events.subscribe("demo", params);
    assert.equal(second.id, first.id);
    assert.equal(sent.length, 1);
    await board.create({ title: "One", project_id: "other" });
    assert.equal(sent.length, 1);
    const task = await board.create({ title: "Two", project_id: "demo" });
    assert.equal(sent.length, 2);
    assert.deepEqual(JSON.parse(sent[1].body).data, task);
    assert.equal(JSON.parse(sent[1].body).eventId, sent[1].headers["webhook-id"]);
    await events.unsubscribe("demo", { ...params, delivery: { mode: "webhook", url: delivery.url } });
    await board.create({ title: "Three", project_id: "demo" });
    assert.equal(sent.length, 2);
    const restored = new Store(join(directory, "subscriptions.json"));
    await restored.load();
    assert.equal(restored.all().length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("rejects a failed challenge and returns the callback error", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-events-"));
  try {
    const store = new Store(join(directory, "subscriptions.json"));
    const events = new Events(store, true, async () => ({ status: 200, body: '{"challenge":"wrong"}' }),
      async () => ({ url: new URL(delivery.url), address: "127.0.0.1", localDemo: true }));
    const board = new DemoBoard(events);
    const result = await handleMcp({ jsonrpc: "2.0", id: 1, method: "events/subscribe", params: {
      name: "task.created", arguments: {}, delivery,
    } }, events, board);
    assert.deepEqual((result as { error: { code: number; data: { reason: string } } }).error,
      { code: -32015, message: "The callback challenge failed.", data: { reason: "challenge_failed" } });
    assert.equal(store.all().length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
