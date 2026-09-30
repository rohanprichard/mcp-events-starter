import assert from "node:assert/strict";
import test from "node:test";
import { checkMcpHeaders, handleMcp } from "../src/mcp.js";
import { Events } from "../src/events.js";
import { Store } from "../src/store.js";
import { DemoBoard } from "../src/demo.js";

const _meta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "1.0.0" },
};

test("uses the MCP 2.0 request and result fields", async () => {
  const events = new Events(new Store("/tmp/unused-mcp-events.json"));
  const board = new DemoBoard(events);
  const request = { jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta } };
  assert.equal(checkMcpHeaders(request, { "mcp-protocol-version": "2026-07-28", "mcp-method": "server/discover" }), null);
  const response = await handleMcp(request, events, board) as { result: Record<string, unknown> };
  assert.equal(response.result.resultType, "complete");
  assert.deepEqual(response.result.supportedVersions, ["2026-07-28"]);
  assert.deepEqual(response.result.capabilities, { tools: {}, events: {} });
  assert.deepEqual(response.result._meta, { "io.modelcontextprotocol/serverInfo": { name: "chatgpt-mcp-events-starter", version: "0.1.0" } });
  const list = await handleMcp({ ...request, method: "events/list" }, events, board) as { result: Record<string, unknown> };
  assert.equal(list.result.resultType, "complete");
  assert.equal((list.result.events as unknown[]).length, 1);
  const tools = await handleMcp({ ...request, method: "tools/list" }, events, board) as { result: Record<string, unknown> };
  assert.equal(tools.result.cacheScope, "private");
  assert.equal(tools.result.ttlMs, 60_000);
});

test("rejects headers that disagree with the request", () => {
  const request = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "create_task", arguments: {}, _meta } };
  assert.equal(checkMcpHeaders(request, { "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": "create_task" }), null);
  assert.notEqual(checkMcpHeaders(request, { "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": "other" }), null);
  assert.notEqual(checkMcpHeaders(request, { "mcp-protocol-version": "2026-07-28", "mcp-method": "events/list" }), null);
  assert.equal(checkMcpHeaders(request, { "mcp-protocol-version": "2025-11-25", "mcp-method": "tools/call", "mcp-name": "create_task" })?.code, -32020);
});
