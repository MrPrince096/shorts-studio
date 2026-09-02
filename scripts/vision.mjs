// Analyze an uploaded image (or a video frame) with Gemini vision and write a script about it.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
function geminiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const p = join(ROOT, ".env");
  if (existsSync(p)) {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*GEMINI_API_KEY\s*=\s*(.*)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "").trim();
    }
  }
  return "";
}

// Describe an uploaded product image in plain text (to inform an ad script).
export async function describeImage({ imageB64, mime = "image/jpeg" }) {
  const key = geminiKey();
  if (!key) throw new Error("NO_GEMINI_KEY");
  const prompt = `Look at this product photo. In 2-3 sentences describe exactly what the product is: its type/category, what it looks like (color, form, packaging, notable features), and any visible brand or text. Be factual and specific — this describes a real product for an advertisement.`;
  const body = { contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: imageB64 } }] }] };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Vision ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const d = await res.json();
  return (d?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
}

export async function visionScript({ imageB64, mime = "image/jpeg", nScenes = 5, language = "English" }) {
  const key = geminiKey();
  if (!key) throw new Error("NO_GEMINI_KEY");
  const nonEng = language && language.toLowerCase() !== "english";
  const prompt = `Look carefully at this image. Create a short, engaging faceless video about its main subject / theme.
- EXACTLY ${nScenes} scenes. Each scene has "text": ONE spoken narration sentence (8-16 words)${nonEng ? ` written in ${language} using its native script` : ""}.
- Scene 1 is a scroll-stopping hook about what's shown. The last scene is a memorable closing line.
- Be accurate to what is actually in the image; make it interesting and factual.
- Also give a "title" (short${nonEng ? `, in ${language}` : ""}), a "description" (one line ending with 2-4 hashtags), and 4-6 "tags".
Return ONLY valid JSON: {"title":"","description":"","tags":["",""],"scenes":[{"text":""}]}`;

  const body = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: imageB64 } }] }],
    generationConfig: { temperature: 0.8, responseMimeType: "application/json" },
  };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) {
    if (res.status === 429) throw new Error("Gemini rate limit — wait a minute and retry.");
    throw new Error(`Vision ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
  const d = await res.json();
  let t = d?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  t = t.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  const j = JSON.parse(t);
  const scenes = (j.scenes || []).filter((s) => s && s.text).map((s) => ({ text: String(s.text), query: "", imagePrompt: "" }));
  if (scenes.length < 2) throw new Error("Vision returned too few scenes — try another image.");
  return { title: j.title || "My Video", description: j.description || "", tags: Array.isArray(j.tags) ? j.tags : [], scenes };
}
