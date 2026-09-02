// Storyteller series: split one story into connected, sequential episodes.
import { callLLM, parseLLMJson } from "./generate.mjs";

const SCENES_FOR = { short: 5, medium: 7, long: 9, xlong: 14, xxlong: 20, huge: 30 };

function slugify(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

// Break a topic/story into `total` sequential episode beats.
export async function createOutline({ topic, total, genre, country, llmProvider }) {
  const flavor = [genre && `Style/genre: ${genre}.`, country && `Set in / related to ${country}.`].filter(Boolean).join(" ");
  const prompt = `Break the story / topic "${topic}" into EXACTLY ${total} sequential episodes for a YouTube Shorts SERIES.
${flavor}
Each episode is ONE story beat that flows directly from the previous one — chronological, no repetition — together covering the whole story from beginning to end (episode 1 = the very start, episode ${total} = the conclusion).
Return ONLY valid JSON, no markdown:
{"seriesTitle":"<short English series name, 2-4 words>","outline":[{"part":1,"beat":"<one English line: what happens in this episode>"}]}`;
  const data = parseLLMJson(await callLLM(prompt, llmProvider));
  const outline = (data.outline || []).map((o, i) => ({ part: i + 1, beat: String(o.beat || "") })).filter((o) => o.beat);
  if (!outline.length) throw new Error("Could not build a series outline. Try a clearer story topic.");
  return { seriesTitle: data.seriesTitle || topic, slug: slugify(data.seriesTitle || topic) || "series", outline };
}

// Write the script for one episode, continuing from `summary`.
export async function episodeConfig(series, part) {
  const beat = (series.outline.find((o) => o.part === part) || {}).beat || "continue the story";
  const nScenes = SCENES_FOR[series.duration] || 7;
  const nonEnglish = series.language && series.language.toLowerCase() !== "english";
  const isLast = part >= series.total;

  const langBlock = nonEnglish
    ? `- Write every "text" (narration) and the "title" in ${series.language} (native script). Keep every "query" in simple ENGLISH (2-4 words).`
    : `- Narration in English.`;

  const prompt = `You are writing episode ${part} of ${series.total} of a faceless YouTube Shorts SERIES titled "${series.seriesTitle}" about "${series.topic}".
THIS episode covers this beat: "${beat}".
Story so far (already shown to viewers — do NOT repeat it, continue smoothly): ${series.summary || "This is the very first episode."}

Write EXACTLY ${nScenes} scenes for THIS episode only.
- Scene 1 briefly reconnects to where we left off, then moves the story forward.
${isLast ? "- This is the FINAL episode: give the story a satisfying conclusion." : "- End on a mini-cliffhanger / hook that makes viewers want the next part."}
- Each scene has: "text" (one spoken sentence, 8-16 words), "query" (2-4 word ENGLISH visual search term), and "imagePrompt" (a rich 15-25 word ENGLISH description of the exact scene — NAME the characters and describe their appearance, clothing, action, setting and mood; be concrete and accurate).
${langBlock}
- Also give an English "recap": ONE line summarizing what happened in THIS episode (for continuity).
- Give a "title" (short, in the narration language) and 4-6 "tags".
Return ONLY valid JSON: {"title":"","recap":"","tags":["",""],"scenes":[{"text":"","query":"","imagePrompt":""}]}`;

  const v = parseLLMJson(await callLLM(prompt, series.llmProvider));
  const scenes = (v.scenes || []).filter((s) => s && s.text && s.query).map((s) => ({ text: String(s.text), query: String(s.query), imagePrompt: String(s.imagePrompt || "") }));
  if (scenes.length < 2) throw new Error(`Episode ${part}: model returned too few scenes.`);
  const partLabel = `Part ${part}`;
  const config = {
    title: `${v.title || series.seriesTitle} — ${partLabel}`,
    slug: `${series.slug}-part-${String(part).padStart(3, "0")}`,
    description: `${series.seriesTitle} — ${partLabel} of ${series.total}. #shorts #story #${series.slug.replace(/-/g, "")}`,
    tags: Array.isArray(v.tags) ? v.tags.concat(["series", series.slug]) : ["series", series.slug],
    voice: series.voice, rate: series.rate || "0%", music: "",
    width: series.width, height: series.height,
    source: series.source || "pexels", videoModel: series.videoModel || "",
    imageStyle: series.imageStyle || "", watermark: series.watermark || "",
    font: series.font || "Arial Black", fontCss: series.fontCss || "", rtl: !!series.rtl,
    scenes,
  };
  return { config, recap: String(v.recap || v.title || `Part ${part}`) };
}
