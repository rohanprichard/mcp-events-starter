import "dotenv/config";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { DemoBoard } from "./demo.js";
import { Events } from "./events.js";
import { authorized, handleMcp, readJson, sendJson } from "./mcp.js";
import { Store } from "./store.js";

const configuredKey = process.env.MCP_API_KEY;
const generatedKey = !configuredKey || configuredKey === "replace-with-a-long-random-value";
const apiKey = generatedKey ? randomBytes(32).toString("hex") : configuredKey;
if (apiKey.length < 24) {
  throw new Error("Set MCP_API_KEY to a random value with at least 24 characters.");
}
const port = Number(process.env.PORT ?? 3000);
const store = new Store(resolve(process.env.SUBSCRIPTIONS_FILE ?? "./data/subscriptions.json"));
await store.load();
const events = new Events(store, process.env.DEMO_ALLOW_HTTP_CALLBACKS === "true");
const board = new DemoBoard(events);

createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  if (path === "/health") return sendJson(response, 200, { status: "ok" });
  if (path !== "/mcp" && path !== "/demo/tasks") return sendJson(response, 404, { error: "The path is not available." });
  if (!authorized(request, apiKey)) return sendJson(response, 401, { error: "The bearer token is not valid." });
  if (request.method !== "POST") return sendJson(response, 405, { error: "Use POST." });
  try {
    const input = await readJson(request);
    if (path === "/demo/tasks") return sendJson(response, 201, await board.create(input));
    const output = await handleMcp(input, events, board);
    if (output === null) { response.writeHead(202); response.end(); return; }
    return sendJson(response, 200, output);
  } catch (error) {
    return sendJson(response, 400, { error: error instanceof Error ? error.message : "The request failed." });
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`MCP server: http://127.0.0.1:${port}/mcp`);
  if (generatedKey) console.log(`Demo bearer token: ${apiKey}`);
});
