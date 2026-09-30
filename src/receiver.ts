import "dotenv/config";
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { sign, signingKey } from "./signatures.js";

const secret = process.env.WEBHOOK_SECRET;
if (!secret) throw new Error("Set WEBHOOK_SECRET before you start the receiver.");
signingKey(secret);

createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/hook") {
    response.writeHead(404).end(); return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 256 * 1024) { response.writeHead(413).end(); return; }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  const id = request.headers["webhook-id"];
  const timestamp = Number(request.headers["webhook-timestamp"]);
  const signature = request.headers["webhook-signature"];
  if (typeof id !== "string" || !Number.isSafeInteger(timestamp) ||
    Math.abs(Date.now() / 1000 - timestamp) > 300 || typeof signature !== "string") {
    response.writeHead(401).end(); return;
  }
  const expected = Buffer.from(sign(secret, id, timestamp, body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    response.writeHead(401).end(); return;
  }
  const payload = JSON.parse(body);
  if (payload.type === "verification") {
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ challenge: payload.challenge }));
    return;
  }
  console.log(JSON.stringify(payload, null, 2));
  response.writeHead(204).end();
}).listen(4000, "127.0.0.1", () => console.log("Receiver: http://127.0.0.1:4000/hook"));
