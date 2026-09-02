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

const SCENES_FOR = { short: 5, medium: 7, long: 9, xlong: 14, xxlong: 20, huge: 30 };
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest"];

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

export async function callLLM(prompt, providerOverride) {
  const provider = (providerOverride || env("LLM_PROVIDER", "gemini")).toLowerCase();
  if (provider === "openai") return llmOpenAI(prompt);
  if (provider === "ollama") return llmOllama(prompt);
  return llmGemini(prompt);
}

// parse JSON possibly wrapped in ```json fences
export function parseLLMJson(raw) {
  let text = String(raw).trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  return JSON.parse(text);
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

// VidIQ-style: brainstorm viral short ideas + titles + SEO tags for a niche.
export async function generateIdeas({ niche, count = 8, language = "English", genre, country, llmProvider }) {
  const focus = [niche && `in the niche: "${niche}"`, genre && `with a "${genre}" style`, country && `related to ${country}`].filter(Boolean).join(", ") || "for a broad audience";
  const prompt = `You are a YouTube growth strategist. Suggest ${count} fresh, high-potential SHORT-video ideas ${focus}.
For EACH idea give: a scroll-stopping "title" (<= 9 words${language && language.toLowerCase() !== "english" ? `, in ${language}` : ""}), a one-line "hook", a short "why" it can go viral, and 4-6 SEO "tags".
Return ONLY JSON: {"ideas":[{"title":"","hook":"","why":"","tags":["",""]}]}`;
  const data = parseLLMJson(await callLLM(prompt, llmProvider));
  return (data.ideas || []).filter((i) => i && i.title).slice(0, count);
}

// UGC ad ideas from a product/person image + optional context.
export async function generateAdIdeas({ productDesc = "", product = "", audience = "", sellingPoint = "", offer = "", count = 5, language = "English", llmProvider }) {
  const ctx = [
    productDesc && `What the image shows: ${productDesc}`,
    product && `Product name: ${product}`,
    audience && `Target audience: ${audience}`,
    sellingPoint && `Main selling point: ${sellingPoint}`,
    offer && `Offer/discount: ${offer}`,
  ].filter(Boolean).join("\n") || "A product the creator wants to advertise.";
  const prompt = `You are a top-performing UGC (user-generated-content) ad strategist for short vertical video.
Given this product, invent ${count} DISTINCT UGC ad concepts a creator could film.
${ctx}

Pick varied angles from: Honest Review, First Impression, Problem → Solution, Testimonial, Unboxing, Product Demo, Before/After, Personal Story, Recommendation, Educational, Comparison, Lifestyle, Reaction, Offer.
For EACH concept return: "title" (<=8 words), "category" (the angle), "hook" (the spoken first 2-3 seconds, punchy), "concept" (one sentence on how the ad plays out), "audience" (who it's for), "style" (visual/tone), "cta" (short call to action).
Write hooks and concepts${language && language.toLowerCase() !== "english" ? ` in ${language}` : ""} in a natural, casual creator voice.
Return ONLY JSON: {"ideas":[{"title":"","category":"","hook":"","concept":"","audience":"","style":"","cta":""}]}`;
  const data = parseLLMJson(await callLLM(prompt, llmProvider));
  return (data.ideas || []).filter((i) => i && i.title).slice(0, count);
}

export async function generateScripts({ topic, genre, country, random, count = 1, duration = "medium", voice, rate = "0%", width, height, source, videoModel, language = "English", font, fontCss, rtl, ad, product, benefits, cta, tone, productImageDesc, llmProvider }) {
  const nScenes = SCENES_FOR[duration] || 7;
  const nonEnglish = language && language.toLowerCase() !== "english";
  const subject = ad
    ? `that is a high-converting ADVERTISEMENT for: "${product || topic}"`
    : buildSubject({ topic, genre, country, random, count });
  const adRules = ad
    ? `\nADVERTISEMENT RULES:
- Structure across the scenes: strong HOOK → the problem/pain → introduce ${product || "the product"} as the solution → 2-3 concrete benefits → a clear CALL TO ACTION.
${productImageDesc ? `- The REAL product (from its photo) looks like this — stay accurate to it: ${productImageDesc}
- Mark "showProduct": true on the 2-3 scenes that directly show/feature the product (product reveal, benefits, final CTA). Mark "showProduct": false on the hook, problem and lifestyle scenes (those get their own visual). For every scene's "query"/"imagePrompt", when showProduct is false describe a fitting DIFFERENT visual (e.g. a frustrated person, a cluttered room, a happy customer).` : ""}
${benefits ? `- Benefits to highlight: ${benefits}.` : ""}
- The FINAL scene MUST be a clear call to action${cta ? `: "${cta}"` : ""}.
- Tone: ${tone || "energetic, persuasive, trustworthy"}. Sound like a real ad, not a lecture.`
    : "";

  const langBlock = nonEnglish
    ? `\nLANGUAGE RULES (very important):
- Write EVERY "text" (the spoken narration) in ${language}, using its native script — natural, fluent, native-speaker quality.
- Write "title" and "description" in ${language} too.
- BUT keep EVERY "query" in simple ENGLISH (2-4 words) — it is used to search a stock-footage library.
- Also add an English "slug": 3-5 lowercase ASCII words, hyphenated, describing the video (used for the filename).`
    : `\n- Also add a short English "slug": 3-5 lowercase ASCII words, hyphenated (used for the filename).`;

  const prompt = `You are an expert faceless YouTube Shorts scriptwriter.
Create ${count} DISTINCT short-video script(s) ${subject}.

For EACH video:
- EXACTLY ${nScenes} scenes.
- Each scene has THREE fields:
  - "text": ONE punchy spoken narration sentence (about 8 to 16 words).
  - "query": a 2 to 4 word ENGLISH stock-footage search term matching the visual (for stock libraries).
  - "imagePrompt": a rich 15-25 word ENGLISH description of the exact scene for an AI image generator — NAME the specific people/characters and describe their appearance, clothing, the action, the setting and mood. Be concrete and accurate (e.g. "Ravana, a fearsome ten-headed demon king in golden armor, seizing princess Sita beside a forest hut").
- Scene 1 is a strong scroll-stopping hook. The final scene is a memorable closing line.
- Keep it factual, vivid and positive. Do NOT put hashtags inside "text".
- Provide "title" (3 to 6 words), "description" (one line ending with 2 to 4 hashtags), and 4 to 6 "tags".${langBlock}${adRules}
${count > 1 ? `Make the ${count} videos cover clearly different angles so they do not repeat.` : ""}

Return ONLY valid JSON, no markdown, of exactly this shape:
{"videos":[{"title":"","slug":"","description":"","tags":["",""],"scenes":[{"text":"","query":"","imagePrompt":"","showProduct":false}]}]}`;

  let raw;
  try {
    raw = await callLLM(prompt, llmProvider);
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
      slug: v.slug || "",
      description: v.description || "",
      tags: Array.isArray(v.tags) ? v.tags : [],
      voice, rate, music: "", width, height,
      source: source || "pexels",
      videoModel: videoModel || "",
      font: font || "Arial Black", fontCss: fontCss || "", rtl: !!rtl,
      scenes: (v.scenes || [])
        .filter((s) => s && s.text && s.query)
        .map((s) => ({ text: String(s.text), query: String(s.query), imagePrompt: String(s.imagePrompt || ""), showProduct: !!s.showProduct })),
    }))
    .filter((v) => v.scenes.length >= 2);
  if (!videos.length) throw new Error("The LLM returned no usable scripts. Try a clearer topic.");
  return videos;
}
