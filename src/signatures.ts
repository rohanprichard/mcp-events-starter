import { createHmac, timingSafeEqual } from "node:crypto";

export function signingKey(secret: string): Buffer {
  if (!secret.startsWith("whsec_")) throw new Error("The secret needs a whsec_ prefix.");
  const encoded = secret.slice(6);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error("The secret needs standard base64 data.");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length < 24 || key.length > 64) throw new Error("The secret needs 24 to 64 bytes.");
  return key;
}

export function sign(secret: string, id: string, timestamp: number, body: string): string {
  const content = `${id}.${timestamp}.${body}`;
  const value = createHmac("sha256", signingKey(secret)).update(content, "utf8").digest("base64");
  return `v1,${value}`;
}

export function sameChallenge(expected: string, actual: unknown): boolean {
  if (typeof actual !== "string") return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}
