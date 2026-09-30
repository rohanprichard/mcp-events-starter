import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { DemoBoard } from "./demo.js";
import { EventError, Events } from "./events.js";

const VERSION = "2026-07-28";
const SERVER_INFO = { name: "chatgpt-mcp-events-starter", version: "0.1.0" };
const SERVER_META = { "io.modelcontextprotocol/serverInfo": SERVER_INFO };

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

export function checkMcpHeaders(input: unknown, headers: IncomingMessage["headers"]): EventError | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return new EventError("The request is not valid.", -32600);
  const request = input as { method?: unknown; params?: { name?: unknown; _meta?: Record<string, unknown> } };
  const bodyVersion = request.params?._meta?.["io.modelcontextprotocol/protocolVersion"];
  if (headers["mcp-protocol-version"] !== bodyVersion || headers["mcp-method"] !== request.method) {
    return new EventError("The MCP headers do not match the request.", -32020);
  }
  if (bodyVersion !== VERSION) return new EventError("The protocol version is not supported.", -32022);
  const named = request.method === "tools/call";
  if (named && headers["mcp-name"] !== request.params?.name) return new EventError("The MCP name does not match the request.", -32020);
  if (!named && headers["mcp-name"] !== undefined) return new EventError("The MCP name is not valid for this method.", -32020);
  return null;
}

export async function handleMcp(input: unknown, events: Events, board: DemoBoard) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new EventError("The request is not valid.", -32600);
  const request = input as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") throw new EventError("The request is not valid.", -32600);
  if (request.id === undefined) return null;
  const params = request.params && typeof request.params === "object" && !Array.isArray(request.params) ? request.params as Record<string, unknown> : {};
  try {
    const meta = params._meta as Record<string, unknown> | undefined;
    if (meta?.["io.modelcontextprotocol/protocolVersion"] !== VERSION) {
      throw new EventError("The protocol version is not supported.", -32022);
    }
    const clientCapabilities = meta["io.modelcontextprotocol/clientCapabilities"];
    if (!clientCapabilities || typeof clientCapabilities !== "object" || Array.isArray(clientCapabilities)) {
      throw new EventError("The client capabilities are not valid.", -32602);
    }
    let result: unknown;
    switch (request.method) {
      case "server/discover":
        result = { resultType: "complete", supportedVersions: [VERSION], capabilities: { tools: {}, events: {} } };
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
        }], ttlMs: 60_000, cacheScope: "private" };
        break;
      case "tools/call":
        if (params.name !== "create_task") throw new EventError("The tool name is not valid.", -32602);
        const task = await board.create(params.arguments);
        result = { structuredContent: task, content: [{ type: "text", text: JSON.stringify(task) }] };
        break;
      default: throw new EventError("The method is not available.", -32601);
    }
    return { jsonrpc: "2.0", id: request.id, result: { resultType: "complete", ...(result as object), _meta: SERVER_META } };
  } catch (error) {
    const failure = error instanceof EventError ? error : new EventError(error instanceof Error ? error.message : "The request failed.");
    return { jsonrpc: "2.0", id: request.id, error: { code: failure.code, message: failure.message,
      ...(failure.reason ? { data: { reason: failure.reason } } : {}) } };
  }
}
