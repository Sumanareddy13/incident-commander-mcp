// @ts-nocheck
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

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

// --- Streamable HTTP wiring (what Archestra expects) ---
const app = express();

// IMPORTANT: use JSON parsing
app.use(express.json({ limit: "2mb" }));

const transport = new StreamableHTTPServerTransport({
  // keep default behavior; Archestra will manage session headers
});

await server.connect(transport);

// Mount transport at ROOT so Archestra can POST to base URL
app.all("/", async (req, res) => {
  try {
    await transport.handleRequest(req, res);
  } catch (e: any) {
    res.status(500).send(String(e?.message ?? e));
  }
});

app.get("/health", (_req, res) => res.json({ ok: true, server: "mcp-logs" }));

const PORT = 7011;
app.listen(PORT, () => console.log(`mcp-logs streamable HTTP MCP at http://localhost:${PORT}`));
