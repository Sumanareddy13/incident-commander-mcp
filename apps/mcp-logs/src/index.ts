// @ts-nocheck
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

type LogLine = { ts: string; service: string; level: string; msg: string };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const FIXTURE = path.join(repoRoot, "fixtures", "logs.jsonl");

function loadLogs(): LogLine[] {
  if (!fs.existsSync(FIXTURE)) throw new Error(`Missing fixture file at: ${FIXTURE}`);
  const raw = fs.readFileSync(FIXTURE, "utf8").trim().split("\n");
  return raw.filter(Boolean).map((l) => JSON.parse(l) as LogLine);
}

const server = new McpServer({ name: "mcp-logs", version: "0.1.0" });

server.tool(
  "search_logs",
  "Search logs by service + pattern (fixture-backed)",
  { service: z.string(), minutes: z.number().int().min(1).max(1440), pattern: z.string() },
  async ({ service, pattern }) => {
    const logs = loadLogs();
    const out = logs
      .filter((l) => l.service === service)
      .filter((l) => l.msg.toLowerCase().includes(pattern.toLowerCase()))
      .slice(0, 30);

    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
  }
);

server.tool(
  "request_restart",
  "Request restart for a service (should be policy-gated)",
  { service: z.string(), reason: z.string().min(5) },
  async ({ service, reason }) => ({
    content: [{ type: "text", text: `RESTART_REQUESTED service=${service} reason=${reason}` }],
  })
);

const app = express();
app.use(express.json());

let transport: any = null;

// IMPORTANT: Archestra should point to /sse (not /)
app.get("/sse", async (req, res) => {
  transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  if (!transport) return res.status(400).send("No active SSE transport. Call GET /sse first.");
  await transport.handlePostMessage(req, res);
});

app.get("/health", (_req, res) => res.json({ ok: true, server: "mcp-logs" }));

const PORT = 7011;
app.listen(PORT, () => console.log(`mcp-logs SSE MCP running at http://localhost:${PORT}/sse`));
