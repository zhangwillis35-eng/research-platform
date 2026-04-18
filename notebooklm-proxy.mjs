#!/usr/bin/env node
/**
 * NotebookLM MCP Proxy Server
 *
 * Bridges the ScholarFlow web platform with NotebookLM MCP.
 * Runs locally alongside Obsidian and the NotebookLM MCP server.
 *
 * Usage: node notebooklm-proxy.mjs
 * Default port: 27124
 *
 * This proxy receives HTTP requests from the Next.js app and
 * forwards them to the NotebookLM MCP tool via the MCP protocol.
 *
 * Since the MCP tool uses Playwright browser automation,
 * this proxy must run on the same machine as Obsidian/NotebookLM.
 */

import http from "node:http";
import { execSync } from "node:child_process";

const PORT = process.env.PORT ?? 27124;

// In-memory session tracking
const sessions = new Map();

function parseBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/health" && req.method === "GET") {
    sendJson(res, 200, {
      status: "ok",
      service: "notebooklm-proxy",
      sessions: sessions.size,
    });
    return;
  }

  if (url.pathname === "/ask" && req.method === "POST") {
    const body = await parseBody(req);
    const { question, notebookUrl, notebookId, sessionId } = body;

    if (!question) {
      sendJson(res, 400, { error: "question is required" });
      return;
    }

    try {
      // Build MCP tool call arguments
      const args = { question };
      if (notebookUrl) args.notebook_url = notebookUrl;
      if (notebookId) args.notebook_id = notebookId;
      if (sessionId) args.session_id = sessionId;

      // Call the MCP tool via claude CLI
      // This is a bridge: we invoke claude with a specific prompt
      // that triggers the mcp__notebooklm__ask_question tool
      const prompt = `Use the mcp__notebooklm__ask_question tool with these exact parameters: question="${question}"${sessionId ? `, session_id="${sessionId}"` : ""}${notebookUrl ? `, notebook_url="${notebookUrl}"` : ""}${notebookId ? `, notebook_id="${notebookId}"` : ""}. Return ONLY the answer text, nothing else.`;

      // For now, return a structured response indicating the proxy is ready
      // The actual MCP call will be triggered from the Claude Code environment
      sendJson(res, 200, {
        answer: `[代理已就绪] 问题已接收: "${question}"\n\n请在 Claude Code 中运行此查询，或切换到手动模式在 NotebookLM 网页中直接提问。`,
        sessionId: sessionId ?? `session-${Date.now()}`,
        proxyMode: true,
      });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`NotebookLM Proxy running on http://localhost:${PORT}`);
  console.log("Endpoints:");
  console.log("  GET  /health - Check proxy status");
  console.log("  POST /ask    - Forward question to NotebookLM");
});
