import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";

const content = [
  "PORT=3000",
  `MCP_API_KEY=${randomBytes(32).toString("hex")}`,
  `WEBHOOK_SECRET=whsec_${randomBytes(32).toString("base64")}`,
  "DEMO_ALLOW_HTTP_CALLBACKS=true",
  "SUBSCRIPTIONS_FILE=./data/subscriptions.json",
  "",
].join("\n");
try {
  await writeFile(".env", content, { flag: "wx", mode: 0o600 });
  console.log("The .env file is ready.");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("The .env file exists. Keep its current secrets.");
  throw error;
}
