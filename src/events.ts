import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sameChallenge, sign, signingKey } from "./signatures.js";
import { Store, type Subscription } from "./store.js";
import { checkedDestination, postChecked } from "./urlSafety.js";

export type Post = (url: string, body: string, headers: Record<string, string>, allowLocalHttp: boolean) => Promise<{ status: number; body: string }>;

export class EventError extends Error {
  constructor(message: string, public readonly code = -32602, public readonly reason?: string) { super(message); }
}

const inputSchema = {
  type: "object",
  properties: { project_id: { type: "string", description: "The project ID to monitor." } },
  additionalProperties: false,
};

export const eventCatalog = [{
  name: "task.created",
  description: "A task was added to the demo board.",
  delivery: ["webhook"],
  inputSchema,
  payloadSchema: {
    type: "object",
    properties: {
      id: { type: "string" }, title: { type: "string" },
      project_id: { type: "string" }, created_at: { type: "string" },
    },
    required: ["id", "title", "project_id", "created_at"],
    additionalProperties: false,
  },
}];

type SubscribeParams = {
  name?: unknown;
  arguments?: unknown;
  delivery?: { mode?: unknown; url?: unknown; secret?: unknown };
  ttlMs?: unknown;
  cursor?: unknown;
};

function parseIdentity(params: SubscribeParams) {
  if (params.name !== "task.created") throw new EventError("The event name is not valid.");
  const args = params.arguments ?? {};
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new EventError("The event arguments are not valid.");
  const values = args as Record<string, unknown>;
  if (Object.keys(values).some((key) => key !== "project_id") ||
    (values.project_id !== undefined && (typeof values.project_id !== "string" || values.project_id.length === 0 || values.project_id.length > 100))) {
    throw new EventError("The project ID is not valid.");
  }
  if (params.delivery?.mode !== "webhook" || typeof params.delivery.url !== "string") {
    throw new EventError("The webhook delivery is not valid.");
  }
  return { name: "task.created" as const, arguments: values.project_id === undefined ? {} : { project_id: values.project_id as string }, url: params.delivery.url };
}

function subscriptionId(owner: string, url: string, args: { project_id?: string }) {
  const identity = JSON.stringify([owner, url, "task.created", args]);
  return `sub_${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
}

function signedHeaders(subscription: Subscription, id: string, body: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signatures = [sign(subscription.secret, id, timestamp, body)];
  if (subscription.previousSecret && subscription.rotationExpiresAt && subscription.rotationExpiresAt > new Date().toISOString()) {
    signatures.push(sign(subscription.previousSecret, id, timestamp, body));
  }
  return {
    "Content-Type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": signatures.join(" "),
    "X-MCP-Subscription-Id": subscription.id,
  };
}

export class Events {
  private readonly verifiedCallbacks = new Map<string, number>();
  constructor(
    private readonly store: Store,
    private readonly allowLocalHttp = false,
    private readonly post: Post = postChecked,
    private readonly checkUrl = checkedDestination,
  ) {}

  list() { return { events: eventCatalog }; }

  async subscribe(owner: string, params: SubscribeParams) {
    const identity = parseIdentity(params);
    if (typeof params.delivery?.secret !== "string") throw new EventError("The signing secret is not valid.");
    try { signingKey(params.delivery.secret); } catch { throw new EventError("The signing secret is not valid."); }
    if (params.cursor !== undefined && params.cursor !== null) throw new EventError("This event does not support a cursor.");
    if (params.ttlMs !== undefined && params.ttlMs !== null &&
      (!Number.isSafeInteger(params.ttlMs) || (params.ttlMs as number) <= 0)) {
      throw new EventError("The subscription lifetime is not valid.");
    }
    try { await this.checkUrl(identity.url, this.allowLocalHttp); }
    catch { throw new EventError("The callback URL is not allowed."); }

    const id = subscriptionId(owner, identity.url, identity.arguments);
    const existing = this.store.get(id);
    const lifetime = Math.min(typeof params.ttlMs === "number" ? params.ttlMs : 24 * 60 * 60 * 1000, 24 * 60 * 60 * 1000);
    const subscription: Subscription = {
      ...identity, id, owner, secret: params.delivery.secret,
      refreshBefore: new Date(Date.now() + lifetime).toISOString(), active: false,
    };
    if (existing?.active && existing.secret !== subscription.secret && existing.refreshBefore > new Date().toISOString()) {
      subscription.previousSecret = existing.secret;
      subscription.rotationExpiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    } else if (existing?.previousSecret && existing.rotationExpiresAt && existing.rotationExpiresAt > new Date().toISOString()) {
      subscription.previousSecret = existing.previousSecret;
      subscription.rotationExpiresAt = existing.rotationExpiresAt;
    }
    const cacheKey = JSON.stringify([owner, identity.url, subscription.secret]);
    if ((existing?.active && existing.secret === subscription.secret && existing.refreshBefore > new Date().toISOString()) ||
      (this.verifiedCallbacks.get(cacheKey) ?? 0) > Date.now()) {
      subscription.active = true;
      await this.store.put(subscription);
    } else {
      await this.store.put(subscription);
      const challenge = randomBytes(32).toString("base64url");
      const messageId = `msg_verification_${randomUUID()}`;
      const body = JSON.stringify({ type: "verification", challenge });
      try {
        const response = await this.post(subscription.url, body, signedHeaders(subscription, messageId, body), this.allowLocalHttp);
        let result: unknown;
        try { result = JSON.parse(response.body); } catch { result = null; }
        if (response.status < 200 || response.status >= 300 ||
          !sameChallenge(challenge, (result as { challenge?: unknown } | null)?.challenge)) {
          throw new EventError("The callback challenge failed.", -32015, "challenge_failed");
        }
        subscription.active = true;
        await this.store.put(subscription);
        this.verifiedCallbacks.set(cacheKey, Date.now() + 5 * 60_000);
      } catch (error) {
        if (existing) await this.store.put(existing);
        else await this.store.remove(id);
        if (error instanceof EventError) throw error;
        const reason = error instanceof Error && error.message.includes("timed out") ? "timeout" : "challenge_failed";
        throw new EventError("The callback challenge failed.", -32015, reason);
      }
    }
    return { id, refreshBefore: subscription.refreshBefore, cursor: null, truncated: false };
  }

  async unsubscribe(owner: string, params: SubscribeParams) {
    const identity = parseIdentity(params);
    const id = subscriptionId(owner, identity.url, identity.arguments);
    if (this.store.get(id)?.owner === owner) await this.store.remove(id);
    return {};
  }

  async emitTask(task: { id: string; title: string; project_id: string; created_at: string }) {
    const event = { eventId: `evt_${randomUUID()}`, name: "task.created", timestamp: task.created_at, data: task, cursor: null };
    const body = JSON.stringify(event);
    if (Buffer.byteLength(body, "utf8") >= 256 * 1024) throw new Error("The event body is too large.");
    const matches = this.store.all().filter((item) => item.active && item.refreshBefore > new Date().toISOString() &&
      item.name === "task.created" && (!item.arguments.project_id || item.arguments.project_id === task.project_id));
    await Promise.all(matches.map(async (subscription) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await this.post(subscription.url, body, signedHeaders(subscription, event.eventId, body), this.allowLocalHttp);
          if (response.status >= 200 && response.status < 300) return;
          if (response.status === 410 || response.status === 413 || (response.status >= 400 && response.status < 500 && response.status !== 429)) return;
        } catch { /* Retry a failed connection. */ }
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
      }
    }));
    return event;
  }
}
