import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { DemoBoard } from "./demo.js";
import { EventError, Events } from "./events.js";

const VERSION = "2026-07-28";

export function authorized(request: IncomingMessage, token: string) {
  const supplied = request.headers.authorization;
  if (!supplied?.startsWith("Bearer ")) return false;
  const left = Buffer.from(supplied.slice(7));
  const right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function readJson(request: IncomingMessage): Promise<unknown> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of request) {
    size += part.length;
    if (size > 256 * 1024) throw new Error("The request body is too large.");
    parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}

export function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

export async function handleMcp(input: unknown, events: Events, board: DemoBoard) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new EventError("The request is not valid.", -32600);
  const request = input as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") throw new EventError("The request is not valid.", -32600);
  if (request.id === undefined) return null;
  const params = request.params && typeof request.params === "object" && !Array.isArray(request.params) ? request.params as Record<string, unknown> : {};
  try {
    let result: unknown;
    switch (request.method) {
      case "server/discover":
        result = { resultType: "complete", supportedVersions: [VERSION], capabilities: { tools: {}, events: {} } };
        break;
      case "initialize":
        result = { protocolVersion: VERSION, capabilities: { tools: {}, events: {} }, serverInfo: { name: "chatgpt-mcp-events-starter", version: "0.1.0" } };
        break;
      case "events/list": result = events.list(); break;
      case "events/subscribe": result = await events.subscribe("demo", params); break;
      case "events/unsubscribe": result = await events.unsubscribe("demo", params); break;
      case "tools/list":
        result = { tools: [{
          name: "create_task", title: "Create a task",
          description: "Add a task to the demo board and send a task.created event.",
          inputSchema: {
            type: "object", properties: {
              title: { type: "string", description: "The task title." },
              project_id: { type: "string", description: "The project ID." },
            }, required: ["title", "project_id"], additionalProperties: false,
          },
          annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        }] };
        break;
      case "tools/call":
        if (params.name !== "create_task") throw new EventError("The tool name is not valid.", -32602);
        const task = await board.create(params.arguments);
        result = { structuredContent: task, content: [{ type: "text", text: JSON.stringify(task) }] };
        break;
      default: throw new EventError("The method is not available.", -32601);
    }
    return { jsonrpc: "2.0", id: request.id, result };
  } catch (error) {
    const failure = error instanceof EventError ? error : new EventError(error instanceof Error ? error.message : "The request failed.");
    return { jsonrpc: "2.0", id: request.id, error: { code: failure.code, message: failure.message,
      ...(failure.reason ? { data: { reason: failure.reason } } : {}) } };
  }
}
