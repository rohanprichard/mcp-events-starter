# MCP Events starter

A small TypeScript server that shows a `task.created` event with MCP 2.0 webhooks.

The server supports protocol version `2026-07-28`. It supplies `server/discover`, `events/list`, `events/subscribe`, `events/unsubscribe`, and the `create_task` tool at `/mcp`. Each event subscription uses a signed callback challenge before delivery. The server keeps subscriptions in a local JSON file. The task board stays in memory.

This repo is a starter. It uses one bearer token for all requests. It does not include OAuth, a production database, or a public plugin package.

## Run the local loop

Use Node.js 20 or later. Use three terminal windows in this directory.

1. Install the packages and make local secrets.

   ```sh
   npm install
   npm run setup
   ```

   The setup command writes `.env` once. Git ignores this file. `npm install && npm run dev` also starts the server without `.env`. In that case, the server prints a temporary bearer token.

2. Start the MCP server in the first terminal.

   ```sh
   npm run dev
   ```

3. Start the callback receiver in the second terminal.

   ```sh
   npm run receiver
   ```

4. Load the local secrets in the third terminal.

   ```sh
   set -a
   . ./.env
   set +a
   ```

5. Subscribe to tasks in the `demo` project.

   ```sh
   curl -sS http://127.0.0.1:3000/mcp \
     -H "Authorization: Bearer $MCP_API_KEY" \
     -H 'MCP-Protocol-Version: 2026-07-28' \
     -H 'Mcp-Method: events/subscribe' \
     -H 'Content-Type: application/json' \
     --data "$(node -e 'console.log(JSON.stringify({jsonrpc:"2.0",id:1,method:"events/subscribe",params:{name:"task.created",arguments:{project_id:"demo"},delivery:{mode:"webhook",url:"http://127.0.0.1:4000/hook",secret:process.env.WEBHOOK_SECRET},_meta:{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}))')"
   ```

   The response contains an `id` and `refreshBefore`. The receiver answers the signed, single-use challenge.

6. Add a task.

   ```sh
   curl -sS http://127.0.0.1:3000/mcp \
     -H "Authorization: Bearer $MCP_API_KEY" \
     -H 'MCP-Protocol-Version: 2026-07-28' \
     -H 'Mcp-Method: tools/call' \
     -H 'Mcp-Name: create_task' \
     -H 'Content-Type: application/json' \
     --data '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create_task","arguments":{"title":"Ship the demo","project_id":"demo"},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
   ```

   The receiver prints the `task.created` event. Use another project ID to test the filter. You can also add a task with `POST /demo/tasks` and the same bearer token.

7. Stop the subscription.

   ```sh
   curl -sS http://127.0.0.1:3000/mcp \
     -H "Authorization: Bearer $MCP_API_KEY" \
     -H 'MCP-Protocol-Version: 2026-07-28' \
     -H 'Mcp-Method: events/unsubscribe' \
     -H 'Content-Type: application/json' \
     --data '{"jsonrpc":"2.0","id":3,"method":"events/unsubscribe","params":{"name":"task.created","arguments":{"project_id":"demo"},"delivery":{"mode":"webhook","url":"http://127.0.0.1:4000/hook"},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
   ```

## The event contract

Call `server/discover` to get the supported protocol version and the `events` capability. Call `events/list` to get the event schema. Send the `2026-07-28` version in each request's `_meta` and `MCP-Protocol-Version` header. Send `Mcp-Method` with each request. Send `Mcp-Name` when you call a tool. The `task.created` filter has an optional `project_id` value. The event data contains `id`, `title`, `project_id`, and `created_at`.

The subscription ID depends on the owner, callback URL, event name, and filter. A repeated request with the same values refreshes the subscription. The server grants a lifetime of at most 24 hours and returns its end time in `refreshBefore`. This event does not support replay, so its `cursor` is `null`.

The server sends one event per POST. It signs the exact JSON bytes with Standard Webhooks HMAC-SHA256. Each delivery has `webhook-id`, `webhook-timestamp`, `webhook-signature`, and `X-MCP-Subscription-Id`. The body stays below 256 KiB. The server retries temporary failures twice. It does not retry HTTP `410` or `413` responses. A changed signing secret gets a five-minute rotation window. The server also caches a successful callback challenge for five minutes.

## Connect to ChatGPT

Use an HTTPS tunnel, such as ngrok, to expose `http://127.0.0.1:3000`. The MCP URL is `https://YOUR-TUNNEL/mcp`. Register that URL as an MCP server in ChatGPT developer mode. Then add it to a plugin and rescan its tools and events. See the [MCP Events guide](https://developers.openai.com/plugins/build/mcp-events) and the [plugin guide](https://developers.openai.com/plugins/build/plugins).

The local bearer token is for curl and other clients that can send it. ChatGPT cannot send a custom API key. A tunnel alone does not make this demo authenticate with ChatGPT. To test a live ChatGPT connection, put an OAuth 2.1 layer in front of this server or replace its token check with OAuth token checks. Use the [ChatGPT authentication guide](https://developers.openai.com/plugins/build/auth) for that work. A public plugin also needs a stable HTTPS service, a plugin package, and the required review steps.

`DEMO_ALLOW_HTTP_CALLBACKS=true` permits only local loopback HTTP callback URLs. It lets the local receiver work. ChatGPT production requires HTTPS callbacks. For other callback URLs, the server checks public IP addresses on each connection and does not follow redirects.

## Check the code

```sh
npm run build
npm test
```

The tests cover the signed challenge, the signature bytes, callback URL checks, subscription changes, and task fan-out.

## Limits

This server has one shared owner and one process. The JSON file keeps subscriptions after a restart, but the task board does not. The server has no event replay, OAuth, delivery queue, or cross-process file lock. Add these parts before you use it for real user data or public traffic.

MIT. Copyright 2026 Rohan Richard.
