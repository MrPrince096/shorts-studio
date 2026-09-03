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
      // NB: no Ollama format:"json" — it collapses gemma3 to "{}". We prompt for
      // JSON and parse robustly (parseLLMJson) instead, which works across models.
      body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0.8 } }),
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

// Robustly pull JSON out of an LLM reply — tolerant of ```fences```, preamble
// text, and trailing commas (small local models like gemma/llama do all three).
export function parseLLMJson(raw) {
  let text = String(raw).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(text); } catch {}
  // grab the outermost {...} or [...] block and drop trailing commas
  const starts = ["{", "["].map((c) => text.indexOf(c)).filter((i) => i >= 0);
  const first = starts.length ? Math.min(...starts) : -1;
  const last = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (first >= 0 && last > first) {
    const cand = text.slice(first, last + 1).replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(cand);
  }
  return JSON.parse(text); // let it throw with the original error
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
const IDEA_TYPE_PHRASE = { shorts: "short-form vertical video", story: "3-to-10-minute narrated story/explainer video", ads: "product or service advertisement" };
export async function generateIdeas({ niche, count = 8, language = "English", genre, country, forType = "shorts", llmProvider }) {
  const what = IDEA_TYPE_PHRASE[forType] || IDEA_TYPE_PHRASE.shorts;
  const focus = [niche && `in the niche: "${niche}"`, genre && `with a "${genre}" style`, country && `related to ${country}`].filter(Boolean).join(", ") || "for a broad audience";
  const prompt = `You are a YouTube growth strategist. Suggest ${count} fresh, high-potential ${what} ideas ${focus}.
For EACH idea give: a scroll-stopping "title" (<= 9 words${language && language.toLowerCase() !== "english" ? `, in ${language}` : ""}), a one-line "hook", a short "why" it can go viral, and 4-6 SEO "tags".
Return ONLY JSON: {"ideas":[{"title":"","hook":"","why":"","tags":["",""]}]}`;
  const data = parseLLMJson(await callLLM(prompt, llmProvider));
  return (data.ideas || []).filter((i) => i && i.title).slice(0, count);
}

// ---- Long-form storytelling (3-10 min). Chunked (outline -> per-beat scenes) so
// small local models never truncate one giant JSON. Great for bedtime / scary /
// biography / tech-explainer narration videos. ----
export const STORY_STYLES = {
  bedtime: "Gentle, soothing, whimsical bedtime-story tone — calm slow pacing, warm and comforting imagery, a peaceful reassuring ending.",
  scary: "Suspenseful, eerie, atmospheric horror tone — build dread slowly, dark vivid imagery, a chilling twist near the end.",
  biography: "Inspiring, informative biography tone — tell the life story in order, the key turning points and struggles, end on their legacy.",
  tech: "Clear, engaging tech-explainer tone — explain the idea simply with concrete real-world examples and why it matters.",
  documentary: "Authoritative, vivid documentary narration — factual, well-structured, cinematic.",
  motivational: "Powerful, uplifting motivational tone — build energy toward an inspiring call to action.",
  cooking: "Warm, mouth-watering world-cuisine narration — vivid sensory food description, the country's culture and the feel of each step, appetizing throughout.",
  fashion: "Stylish, trend-savvy narration on dressing styles and fashion across cultures — descriptive, aspirational, culturally rich.",
  educational: "Clear, curious explainer narration — break down how it works with concrete examples and satisfying 'aha' moments.",
  history: "Vivid, immersive historical narration — set the scene, the people, the stakes and the turning points like a great documentary.",
  war: "Gripping, respectful war-history narration — the tension, the strategy, the human cost and the turning points of the conflict.",
  story: "Engaging narrative storytelling with a clear beginning, middle and satisfying end.",
};
// build a rich subject when a country is chosen (great for cooking / history / culture per country)
function countrySubject(storyType, country) {
  const m = {
    cooking: `the traditional cuisine and most iconic dishes of ${country}`,
    fashion: `the traditional dress and fashion styles of ${country}`,
    history: `the history of ${country}`,
    war: `the great wars and battles in the history of ${country}`,
    biography: `an iconic figure from ${country}`,
    documentary: `the culture, land and people of ${country}`,
    educational: `fascinating facts about ${country}`,
    bedtime: `a gentle folk tale from ${country}`,
    scary: `a chilling legend or ghost story from ${country}`,
    motivational: `an inspiring true story from ${country}`,
    story: `a captivating story set in ${country}`,
  };
  return m[storyType] || `${country}`;
}
export async function generateStory({ topic, country = "", storyType = "story", minutes = 3, language = "English", voice, rate = "0%", width, height, source, videoModel, font, fontCss, rtl, llmProvider, instructions, onProgress }) {
  const style = STORY_STYLES[storyType] || STORY_STYLES.story;
  const nonEnglish = language && language.toLowerCase() !== "english";
  // subject weaves the country in (country-only, topic-only, or both)
  const subject = topic && country ? `${topic} — ${storyType === "cooking" ? `authentic ${country} cuisine` : country}`
    : topic ? topic
      : countrySubject(storyType, country);
  topic = subject;
  const beats = Math.max(4, Math.min(16, Math.round(minutes * 2)));            // story sections
  const scenesPerBeat = Math.max(2, Math.round((minutes * 140) / beats / 28)); // ~28 words/scene
  const log = (m) => { try { onProgress && onProgress(m); } catch {} };

  // 1) Outline — a title + ordered beats forming a full arc
  log(`✍️  Outlining a ${minutes}-min ${storyType} about "${topic}"…`);
  // keep the outline JSON SMALL so small local models return valid JSON reliably
  const outPrompt = `You are a master ${storyType} storyteller. Plan a ${minutes}-minute ${storyType} video about: ${topic}.
Style: ${style}
Give a compelling "title"${nonEnglish ? ` (in ${language})` : ""} and EXACTLY ${beats} sequential story "beats" (one short sentence each, in order, forming a complete arc with a satisfying ending).${instructions ? `\nCreator instructions: ${instructions}` : ""}
Return ONLY JSON: {"title":"","beats":["",""]}`;
  const tryOutline = async (prompt, n = 3) => {
    for (let a = 0; a < n; a++) {
      try { const o = parseLLMJson(await callLLM(prompt, llmProvider)); if (o) return o; }
      catch (e) { if (String(e.message).startsWith("NO_LLM_KEY")) throw e; }
    }
    return null;
  };
  let outline = await tryOutline(outPrompt);
  let title = (outline && outline.title) || topic;
  let beatList = ((outline && outline.beats) || []).slice(0, beats).filter(Boolean);
  if (beatList.length < 2) {
    // fallback: ask for just the beats with the simplest possible schema
    log("↩️  Retrying the outline (simpler)…");
    const o2 = await tryOutline(`List EXACTLY ${beats} short sequential plot points (one sentence each) for a ${minutes}-minute ${storyType} about: ${topic}. Return ONLY JSON: {"beats":["",""]}`, 3);
    beatList = ((o2 && o2.beats) || []).slice(0, beats).filter(Boolean);
  }
  if (beatList.length < 2) throw new Error("Could not outline the story — try a shorter, simpler topic, or switch Script AI to Gemini in Settings.");

  // 2) Per-beat narration scenes (each call is small -> reliable JSON)
  const langLine = nonEnglish
    ? `Write "text" in ${language} using its native script. Keep "query" in simple ENGLISH (2-4 words).`
    : `Keep "query" a 2-4 word ENGLISH stock-footage search term.`;
  const scenes = [];
  for (let i = 0; i < beatList.length; i++) {
    log(`📝 Writing part ${i + 1}/${beatList.length}…`);
    const prev = scenes.length ? scenes[scenes.length - 1].text : "";
    const p = `You are writing a ${minutes}-minute ${storyType} titled "${title}". Style: ${style}
This is section ${i + 1} of ${beatList.length}: "${beatList[i]}".
Write ${scenesPerBeat} consecutive narration scenes for THIS section that flow on from the story so far.
${prev ? `The previous narration line was: "${prev}". Continue naturally; do NOT repeat it.` : "This is the opening — hook the viewer immediately."}
Each scene has: "text" (1-2 spoken narration sentences in a ${storyType} tone, about 20-30 words), "query", and "imagePrompt" (a 15-25 word ENGLISH description of the visual).
PERFORMANCE (important — this is READ ALOUD by a narrator): write it to be spoken with feeling — short punchy sentences, deliberate pauses using "…" for suspense or comic timing, vivid sensory detail, and speak straight to the listener ("you", "imagine") so it feels like a real person telling the story. Lean HARD into the ${storyType} emotion.
${langLine}
Return ONLY JSON: {"scenes":[{"text":"","query":"","imagePrompt":""}]}`;
    try {
      const d = parseLLMJson(await callLLM(p, llmProvider));
      (d.scenes || []).filter((s) => s && s.text && s.query)
        .forEach((s) => scenes.push({ text: String(s.text).replace(/[*_`]/g, "").replace(/\s+/g, " ").trim(), query: String(s.query), imagePrompt: String(s.imagePrompt || ""), showProduct: false }));
    } catch { /* skip a bad section rather than fail the whole story */ }
  }
  if (scenes.length < 3) throw new Error("The story came out too short. Try again or a clearer topic.");

  const slug = (title || "story").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "story";
  log(`✅ Story ready — ${scenes.length} scenes.`);
  // SEO metadata as a SEPARATE small call (best-effort — never blocks the story)
  let meta = {};
  try {
    meta = parseLLMJson(await callLLM(`For a ${storyType} YouTube video titled "${title}" about ${topic}, write a "description" (2-3 engaging sentences that hook the viewer${nonEnglish ? `, in ${language}` : ""}) and 10-12 "tags" (lowercase keywords, no # sign). Return ONLY JSON: {"description":"","tags":["",""]}`, llmProvider)) || {};
  } catch { /* keep going with fallbacks */ }
  const tags = (Array.isArray(meta.tags) && meta.tags.length ? meta.tags : [storyType, "story", "storytime", "narration"])
    .map((t) => String(t).replace(/^#/, "").trim()).filter(Boolean).slice(0, 14);
  return {
    title, slug,
    description: (meta.description && String(meta.description).trim()) || `${title} — a ${minutes}-minute ${storyType}.`,
    tags,
    voice, rate, music: "", width, height,
    source: source || "pexels", videoModel: videoModel || "",
    font: font || "Arial Black", fontCss: fontCss || "", rtl: !!rtl,
    scenes,
  };
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

export async function generateScripts({ topic, genre, country, random, count = 1, duration = "medium", voice, rate = "0%", width, height, source, videoModel, language = "English", font, fontCss, rtl, ad, product, benefits, cta, tone, productImageDesc, instructions, llmProvider }) {
  const nScenes = SCENES_FOR[duration] || 7;
  const nonEnglish = language && language.toLowerCase() !== "english";
  const instrBlock = instructions && instructions.trim()
    ? `\nCREATOR INSTRUCTIONS (follow these closely — they define how the video should go):\n${instructions.trim()}`
    : "";
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
- Provide "title" (3 to 6 words, scroll-stopping), an engaging "description" (2 short sentences that hook the viewer, then 2-3 hashtags), and 8 to 10 SEO "tags" (lowercase keywords, no # sign).${langBlock}${adRules}${instrBlock}
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
  let parsed;
  try { parsed = parseLLMJson(raw); }
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
