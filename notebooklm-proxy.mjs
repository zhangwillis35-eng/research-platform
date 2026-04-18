#!/usr/bin/env node
/**
 * NotebookLM Auto-Mode Proxy Server
 *
 * Bridges ScholarFlow web app → NotebookLM Python API
 * Runs locally on port 27125
 *
 * Usage: node notebooklm-proxy.mjs
 *
 * Prerequisites:
 *   - notebooklm-mcp-cli installed (uv tool install notebooklm-mcp-cli)
 *   - Already authenticated (run `notebooklm-mcp setup-auth` first)
 */

import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const PORT = 27125;

// Track sessions
const sessions = new Map();

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
  });
}

/**
 * Call NotebookLM via Python subprocess
 * Uses the notebooklm-tools library directly
 */
async function askNotebookLM(question, notebookUrl, sessionId) {
  const pythonScript = `
import json, sys
from notebooklm_tools.core.client import NotebookLMClient

client = NotebookLMClient()

notebook_url = ${JSON.stringify(notebookUrl || "")}
question = ${JSON.stringify(question)}
session_id = ${JSON.stringify(sessionId || "")}

try:
    # Navigate to notebook if URL provided
    if notebook_url:
        notebook_id = notebook_url.split("/notebook/")[-1].split("?")[0]

    # Ask question using the conversation API
    result = client.ask(question)

    print(json.dumps({
        "success": True,
        "answer": result if isinstance(result, str) else str(result),
        "session_id": session_id or "auto"
    }))
except Exception as e:
    print(json.dumps({
        "success": False,
        "error": str(e)
    }))
`;

  try {
    const { stdout } = await exec("python3", ["-c", pythonScript], {
      timeout: 120000, // 2 min timeout
      env: { ...process.env },
    });

    const lines = stdout.trim().split("\n");
    const lastLine = lines[lines.length - 1];
    return JSON.parse(lastLine);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

const server = http.createServer(async (req, res) => {
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

  if (url.pathname === "/health") {
    sendJson(res, 200, {
      status: "ok",
      service: "notebooklm-proxy",
      port: PORT,
      sessions: sessions.size,
    });
    return;
  }

  if (url.pathname === "/ask" && req.method === "POST") {
    const body = await parseBody(req);
    const { question, notebookUrl, sessionId } = body;

    if (!question) {
      sendJson(res, 400, { error: "question is required" });
      return;
    }

    console.log(`[NLM] Asking: "${question.slice(0, 60)}..."`);

    const result = await askNotebookLM(question, notebookUrl, sessionId);

    if (result.success) {
      console.log(`[NLM] Got answer (${result.answer?.length ?? 0} chars)`);
      sendJson(res, 200, {
        answer: result.answer,
        sessionId: result.session_id ?? sessionId ?? `s-${Date.now()}`,
        source: "notebooklm",
      });
    } else {
      console.error(`[NLM] Error: ${result.error}`);
      sendJson(res, 500, { error: result.error });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`\n  NotebookLM Proxy running on http://localhost:${PORT}\n`);
  console.log("  Endpoints:");
  console.log("    GET  /health  — Check status");
  console.log("    POST /ask     — Ask NotebookLM a question\n");
  console.log("  Make sure you've authenticated with: notebooklm-mcp setup-auth\n");
});
