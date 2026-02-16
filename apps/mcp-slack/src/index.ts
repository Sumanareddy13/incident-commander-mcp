// @ts-nocheck
import express from "express";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebClient } from "@slack/web-api";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
dotenv.config({ path: path.join(repoRoot, ".env") });

const token = process.env.SLACK_BOT_TOKEN;
if (!token) throw new Error("Missing SLACK_BOT_TOKEN in repo root .env");

const slack = new WebClient(token);
const server = new McpServer({ name: "mcp-slack", version: "0.1.0" });

server.tool(
  "post_message",
  "Post a message to a Slack channel",
  { channel: z.string(), text: z.string() },
  async ({ channel, text }) => {
    const res = await slack.chat.postMessage({ channel, text });
    return { content: [{ type: "text", text: `ok ts=${res.ts}` }] };
  }
);

server.tool(
  "read_recent_messages",
  "Read recent messages from a Slack channel",
  { channel: z.string(), minutes: z.number().int().min(1).max(240) },
  async ({ channel, minutes }) => {
    const oldest = Math.floor(Date.now() / 1000) - minutes * 60;
    const res = await slack.conversations.history({
      channel,
      oldest: String(oldest),
      limit: 20,
    });
    const msgs = (res.messages ?? []).map((m: any) => ({ ts: m.ts, text: m.text }));
    return { content: [{ type: "text", text: JSON.stringify(msgs, null, 2) }] };
  }
);

const app = express();
app.use(express.json());

let transport: any = null;

app.get("/sse", async (req, res) => {
  transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  if (!transport) return res.status(400).send("No active SSE transport. Call GET /sse first.");
  await transport.handlePostMessage(req, res);
});

app.get("/health", (_req, res) => res.json({ ok: true, server: "mcp-slack" }));

const PORT = 7012;
app.listen(PORT, () => console.log(`mcp-slack SSE MCP running at http://localhost:${PORT}/sse`));
