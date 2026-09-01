// Turn a topic into ready-to-render script config(s) using Google Gemini (free tier).
// Reads GEMINI_API_KEY from env or .env. Exported for the server.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function getKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const p = join(ROOT, ".env");
  if (existsSync(p)) {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*GEMINI_API_KEY\s*=\s*(.*)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "").trim();
    }
  }
  return null;
}

const SCENES_FOR = { short: 5, medium: 7, long: 9 };
const MODELS = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash"];

export async function generateScripts({ topic, count = 1, duration = "medium", voice, rate = "0%", width, height }) {
  const key = getKey();
  if (!key) throw new Error("NO_GEMINI_KEY");
  const nScenes = SCENES_FOR[duration] || 7;

  const prompt = `You are an expert faceless YouTube Shorts scriptwriter.
Create ${count} DISTINCT short-video script(s) about: "${topic}".

For EACH video:
- EXACTLY ${nScenes} scenes.
- Each scene has "text" (ONE punchy spoken narration sentence, about 8 to 16 words) and "query" (a 2 to 4 word ENGLISH stock-footage search term for Pexels that literally matches that sentence's visual).
- Scene 1 is a strong scroll-stopping hook. The final scene is a memorable closing line.
- Keep it factual, vivid and positive. Do NOT put hashtags inside "text".
- Provide "title" (3 to 6 words), "description" (one line ending with 2 to 4 hashtags), and 4 to 6 "tags".
${count > 1 ? `Make the ${count} videos cover clearly different angles so they do not repeat.` : ""}

Return ONLY valid JSON, no markdown, of exactly this shape:
{"videos":[{"title":"","description":"","tags":["",""],"scenes":[{"text":"","query":""}]}]}`;

  let lastErr = "";
  for (const model of MODELS) {
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
    } catch (e) {
      lastErr = "network: " + e.message;
      continue;
    }
    if (!res.ok) {
      lastErr = `${model} -> HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`;
      if (res.status === 400 || res.status === 404) continue; // try next model
      if (res.status === 429) throw new Error("Gemini rate limit hit — wait a minute and retry.");
      if (res.status === 403) throw new Error("Gemini key rejected — check GEMINI_API_KEY in .env.");
      continue;
    }
    const data = await res.json();
    let text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    text = text.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      lastErr = "invalid JSON from " + model;
      continue;
    }
    const videos = (parsed.videos || []).map((v) => ({
      title: v.title || topic,
      description: v.description || "",
      tags: Array.isArray(v.tags) ? v.tags : [],
      voice,
      rate,
      music: "",
      width,
      height,
      scenes: (v.scenes || [])
        .filter((s) => s && s.text && s.query)
        .map((s) => ({ text: String(s.text), query: String(s.query) })),
    })).filter((v) => v.scenes.length >= 2);
    if (videos.length) return videos;
    lastErr = "no usable videos from " + model;
  }
  throw new Error("Script generation failed. " + lastErr);
}
