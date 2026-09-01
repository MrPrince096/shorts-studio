// Turn a topic into ready-to-render script config(s) using a pluggable LLM.
// Providers: gemini (default) | openai (GPT) | ollama (local/offline).
// Config read from env or .env: LLM_PROVIDER, GEMINI_API_KEY, OPENAI_API_KEY,
// OPENAI_MODEL, OLLAMA_URL, OLLAMA_MODEL.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function env(key, dflt = "") {
  if (process.env[key]) return process.env[key];
  const p = join(ROOT, ".env");
  if (existsSync(p)) {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)\\s*$`));
      if (m) return m[1].replace(/^["']|["']$/g, "").trim();
    }
  }
  return dflt;
}

const SCENES_FOR = { short: 5, medium: 7, long: 9 };
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite"];

// ---------- LLM providers: each takes a prompt, returns raw text ----------
async function llmGemini(prompt) {
  const key = env("GEMINI_API_KEY");
  if (!key) throw new Error("NO_LLM_KEY:gemini");
  let lastErr = "";
  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.9, responseMimeType: "application/json" },
        }),
      });
    } catch (e) { lastErr = "network: " + e.message; continue; }
    if (!res.ok) {
      const t = (await res.text()).slice(0, 160);
      if (res.status === 403) throw new Error("Gemini key rejected (403).");
      if (res.status === 429) throw new Error("Gemini rate limit — wait a minute.");
      lastErr = `${model}: HTTP ${res.status} ${t}`;
      continue; // try next model
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) return text;
    lastErr = "empty response from " + model;
  }
  throw new Error("Gemini failed. " + lastErr);
}

async function llmOpenAI(prompt) {
  const key = env("OPENAI_API_KEY");
  if (!key) throw new Error("NO_LLM_KEY:openai");
  const model = env("OPENAI_MODEL", "gpt-4o-mini");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.9,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("OpenAI key rejected (401).");
    throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || "";
}

async function llmOllama(prompt) {
  const base = env("OLLAMA_URL", "http://localhost:11434").replace(/\/$/, "");
  const model = env("OLLAMA_MODEL", "llama3.1");
  let res;
  try {
    res = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false, format: "json", options: { temperature: 0.9 } }),
    });
  } catch (e) {
    throw new Error(`Ollama not reachable at ${base} — is it running? (${e.message})`);
  }
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  return data?.response || "";
}

async function callLLM(prompt) {
  const provider = env("LLM_PROVIDER", "gemini").toLowerCase();
  if (provider === "openai") return llmOpenAI(prompt);
  if (provider === "ollama") return llmOllama(prompt);
  return llmGemini(prompt);
}

// ---------- prompt building ----------
function buildSubject({ topic, genre, country, random, count }) {
  if (random) {
    return `on ${count} completely different, surprising, highly shareable topics that YOU invent` +
      (genre ? ` within the "${genre}" genre` : "") +
      (country ? `, all related to ${country}` : "");
  }
  const bits = [];
  if (topic) bits.push(`about "${topic}"`);
  if (country && !topic) bits.push(`about the country ${country} — its culture, food, places, people, history or what makes it unique`);
  else if (country) bits.push(`connected to ${country}`);
  if (genre) bits.push(`in the "${genre}" style/genre`);
  if (!bits.length) return `on ${count} highly engaging, viral-worthy topics of your choice`;
  return bits.join(", ");
}

export async function generateScripts({ topic, genre, country, random, count = 1, duration = "medium", voice, rate = "0%", width, height, source, videoModel }) {
  const nScenes = SCENES_FOR[duration] || 7;
  const subject = buildSubject({ topic, genre, country, random, count });

  const prompt = `You are an expert faceless YouTube Shorts scriptwriter.
Create ${count} DISTINCT short-video script(s) ${subject}.

For EACH video:
- EXACTLY ${nScenes} scenes.
- Each scene has "text" (ONE punchy spoken narration sentence, about 8 to 16 words) and "query" (a 2 to 4 word ENGLISH stock-footage / visual search term that literally matches that sentence's visual).
- Scene 1 is a strong scroll-stopping hook. The final scene is a memorable closing line.
- Keep it factual, vivid and positive. Do NOT put hashtags inside "text".
- Provide "title" (3 to 6 words), "description" (one line ending with 2 to 4 hashtags), and 4 to 6 "tags".
${count > 1 ? `Make the ${count} videos cover clearly different angles so they do not repeat.` : ""}

Return ONLY valid JSON, no markdown, of exactly this shape:
{"videos":[{"title":"","description":"","tags":["",""],"scenes":[{"text":"","query":""}]}]}`;

  let raw;
  try {
    raw = await callLLM(prompt);
  } catch (e) {
    if (String(e.message).startsWith("NO_LLM_KEY")) throw new Error("NO_LLM_KEY");
    throw e;
  }
  let text = String(raw).trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new Error("The LLM did not return valid JSON. Try again or switch model."); }

  const videos = (parsed.videos || parsed.scripts || (Array.isArray(parsed) ? parsed : []))
    .map((v) => ({
      title: v.title || topic || "Short",
      description: v.description || "",
      tags: Array.isArray(v.tags) ? v.tags : [],
      voice, rate, music: "", width, height,
      source: source || "pexels",
      videoModel: videoModel || "",
      scenes: (v.scenes || [])
        .filter((s) => s && s.text && s.query)
        .map((s) => ({ text: String(s.text), query: String(s.query) })),
    }))
    .filter((v) => v.scenes.length >= 2);
  if (!videos.length) throw new Error("The LLM returned no usable scripts. Try a clearer topic.");
  return videos;
}
