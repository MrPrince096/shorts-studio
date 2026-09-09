#!/usr/bin/env node
// Shorts Studio — MCP server (zero dependencies).
//
// Exposes Shorts Studio's actions as tools so an AI assistant (Claude Desktop,
// Cursor, Claude Code, …) can drive it in natural language: "make 3 shorts
// about space", "start a Japanese comparison video", "turn autopilot on".
//
// It talks to the RUNNING Shorts Studio app over its local HTTP API, so the app
// (or `npm start`) must be running. Point it elsewhere with SHORTS_URL.
//
// Protocol: MCP over stdio (newline-delimited JSON-RPC 2.0). Nothing but
// protocol JSON may go to stdout — all logging goes to stderr.
import { createInterface } from "node:readline";

const BASE = (process.env.SHORTS_URL || "http://localhost:4321").replace(/\/$/, "");
const NAME = "shorts-studio";
const VERSION = "1.0.0";
const log = (...a) => process.stderr.write("[shorts-mcp] " + a.join(" ") + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, method = "GET", body) {
  let r;
  try {
    r = await fetch(BASE + path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    throw new Error(`Can't reach Shorts Studio at ${BASE} — is the app (or 'npm start') running? (${e.message})`);
  }
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!r.ok) throw new Error(json.error || `${path} → HTTP ${r.status}`);
  return json;
}
// Kick off a render job and wait (bounded) for it to finish.
async function runJob(path, body, maxMs = 300000) {
  const { jobId } = await api(path, "POST", body);
  if (!jobId) throw new Error("no job id returned");
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await sleep(3000);
    const s = await api(`/api/status/${jobId}`);
    if (s.status !== "running") return { jobId, status: s.status, files: s.files || [], log: (s.log || []).slice(-3) };
  }
  return { jobId, status: "running", files: [], note: "Still rendering — check again with get_job_status." };
}

// ---- tool definitions ----
const TOOLS = [
  {
    name: "suggest_topic",
    description: "Invent a fresh, specific video topic. Optionally seed it with a niche and content type.",
    inputSchema: { type: "object", properties: {
      niche: { type: "string", description: "Theme to seed from, e.g. 'space facts' (optional)" },
      type: { type: "string", enum: ["shorts", "story", "comparison"], description: "What it's for (optional)" },
      language: { type: "string", description: "Language for the idea (optional, default English)" },
    } },
  },
  {
    name: "create_short",
    description: "Generate one or more short videos from a topic (AI script → voiceover → footage → render). Returns the output file(s). Takes a few minutes.",
    inputSchema: { type: "object", properties: {
      topic: { type: "string", description: "What the short is about" },
      count: { type: "integer", minimum: 1, maximum: 5, description: "How many shorts (default 1)" },
      language: { type: "string", description: "Spoken/caption language (default English)" },
    }, required: ["topic"] },
  },
  {
    name: "create_story",
    description: "Generate a narrated story video (3–10 min) in a chosen style. Takes several minutes.",
    inputSchema: { type: "object", properties: {
      topic: { type: "string", description: "Story subject" },
      storyType: { type: "string", description: "Style, e.g. space, history, mystery, bedtime, biography (default story)" },
      minutes: { type: "integer", minimum: 1, maximum: 10, description: "Target length (default 3)" },
      language: { type: "string" },
    }, required: ["topic"] },
  },
  {
    name: "create_comparison",
    description: "Generate a split-screen 'Comparison' language video (e.g. Textbook vs Casual Japanese) with native + romaji + English captions. Takes a few minutes (much longer if animate=true).",
    inputSchema: { type: "object", properties: {
      language: { type: "string", description: "Target language, e.g. Japanese, Korean, Spanish" },
      topic: { type: "string", description: "Theme, e.g. 'everyday phrases', 'at a restaurant' (optional)" },
      count: { type: "integer", minimum: 2, maximum: 10, description: "Number of scenes (default 6)" },
      leftLabel: { type: "string" }, rightLabel: { type: "string" },
      animate: { type: "boolean", description: "Real AI video motion per panel (LTX). Very slow on Apple Silicon; needs Local engines on." },
    }, required: ["language"] },
  },
  {
    name: "get_job_status",
    description: "Check a render job started earlier (by its jobId).",
    inputSchema: { type: "object", properties: { jobId: { type: "string" } }, required: ["jobId"] },
  },
  {
    name: "list_videos",
    description: "List the most recent rendered videos in the library.",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 } } },
  },
  {
    name: "autopilot_status",
    description: "Get the autopilot configuration and recent auto-generated runs.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "autopilot_configure",
    description: "Configure the autopilot (self-running channel). Set enabled + niche + cadence; it then invents topics and generates videos on a timer.",
    inputSchema: { type: "object", properties: {
      enabled: { type: "boolean" },
      niche: { type: "string", description: "Channel theme that seeds topics" },
      type: { type: "string", enum: ["shorts", "story", "comparison"] },
      language: { type: "string" },
      storyType: { type: "string" },
      compareLanguage: { type: "string" },
      intervalHours: { type: "integer", minimum: 1, maximum: 168 },
      perRun: { type: "integer", minimum: 1, maximum: 5 },
    } },
  },
  {
    name: "autopilot_run_now",
    description: "Trigger one autopilot generation immediately (uses the saved settings).",
    inputSchema: { type: "object", properties: {} },
  },
];

async function callTool(name, args = {}) {
  switch (name) {
    case "suggest_topic": {
      const j = await api("/api/topic", "POST", { forType: args.type || "shorts", type: args.type === "story" ? "" : "", hint: args.niche || "", language: args.language || "English" });
      return `Topic: ${j.topic || "(none)"}`;
    }
    case "create_short": {
      const r = await runJob("/api/generate", { topic: args.topic, count: Math.min(5, Math.max(1, args.count || 1)), source: "image", aspect: "9:16", quality: "1080", language: args.language || "English" });
      return r.status === "done" ? `✅ Done — ${r.files.length} video(s): ${r.files.join(", ")}` : `Job ${r.jobId}: ${r.status}. ${r.note || (r.log || []).join(" | ")}`;
    }
    case "create_story": {
      const r = await runJob("/api/story", { topic: args.topic, storyType: args.storyType || "story", minutes: Math.min(10, Math.max(1, args.minutes || 3)), source: "image", aspect: "9:16", quality: "1080", language: args.language || "English" });
      return r.status === "done" ? `✅ Story done: ${r.files.join(", ")}` : `Job ${r.jobId}: ${r.status}. ${r.note || ""}`;
    }
    case "create_comparison": {
      const r = await runJob("/api/comparison", { language: args.language, topic: args.topic || "", count: Math.min(10, Math.max(2, args.count || 6)), leftLabel: args.leftLabel || "", rightLabel: args.rightLabel || "", source: "image", voice: true, animate: !!args.animate }, args.animate ? 1800000 : 400000);
      return r.status === "done" ? `✅ Comparison done: ${r.files.join(", ")}` : `Job ${r.jobId}: ${r.status}. ${r.note || ""}`;
    }
    case "get_job_status": {
      const s = await api(`/api/status/${args.jobId}`);
      return `Job ${args.jobId}: ${s.status}${s.files && s.files.length ? " — " + s.files.join(", ") : ""}\n${(s.log || []).slice(-4).join("\n")}`;
    }
    case "list_videos": {
      const list = await api("/api/videos");
      const top = (Array.isArray(list) ? list : []).slice(0, args.limit || 12);
      return top.length ? top.map((v) => `• ${v.file}${v.title ? ` — ${v.title}` : ""}`).join("\n") : "No videos yet.";
    }
    case "autopilot_status": {
      const c = await api("/api/autopilot");
      const hist = (c.history || []).slice(0, 6).map((h) => `  • [${h.status}] ${h.topic || "(random)"} ${h.file ? "→ " + h.file : ""}`).join("\n");
      return `Autopilot: ${c.enabled ? "ON" : "off"} · type=${c.type} · niche="${c.niche || ""}" · every ${c.intervalHours}h${c.running ? " · (generating now)" : ""}\nRecent:\n${hist || "  (none)"}`;
    }
    case "autopilot_configure": {
      const c = await api("/api/autopilot", "POST", args);
      return `Autopilot updated: ${c.enabled ? "ON" : "off"} · type=${c.type} · niche="${c.niche || ""}" · every ${c.intervalHours}h · ${c.perRun}/run`;
    }
    case "autopilot_run_now": {
      await api("/api/autopilot/run", "POST", {});
      return "▶️ Autopilot is generating one video now. Use autopilot_status to watch progress.";
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ---- JSON-RPC over stdio ----
function send(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }
function reply(id, result) { send({ jsonrpc: "2.0", id, result }); }
function replyErr(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return reply(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: NAME, version: VERSION } });
  }
  if (method === "tools/list") return reply(id, { tools: TOOLS });
  if (method === "tools/call") {
    const tn = params?.name;
    try {
      const text = await callTool(tn, params?.arguments || {});
      return reply(id, { content: [{ type: "text", text }] });
    } catch (e) {
      return reply(id, { content: [{ type: "text", text: "Error: " + e.message }], isError: true });
    }
  }
  if (method === "ping") return reply(id, {});
  if (id !== undefined && method) return replyErr(id, -32601, `Method not found: ${method}`);
  // notifications (no id) — nothing to reply
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const s = line.trim(); if (!s) return;
  let msg; try { msg = JSON.parse(s); } catch { return; }
  Promise.resolve(handle(msg)).catch((e) => log("handler error:", e.message));
});
log(`ready — talking to ${BASE}`);
