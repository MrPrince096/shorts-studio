// One-shot: build (TTS + Pexels + timings) then render to a title-named MP4 in out/
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function slug(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// 1. build assets + props
execFileSync("node", [join(__dirname, "build.mjs")], { stdio: "inherit", cwd: ROOT });

// 2. derive output filename — prefer the English slug (works for any language title)
const config = JSON.parse(readFileSync(join(ROOT, "scenes.json"), "utf8"));
const name = slug(config.slug) || slug(config.title) || `video-${Date.now()}`;
const outPath = `out/${name}.mp4`;

// 3. render
console.log(`\n🎥 Rendering -> ${outPath}`);
execFileSync("npx", ["remotion", "render", "Short", outPath, "--props=public/props.json"], {
  stdio: "inherit",
  cwd: ROOT,
});
// keep the voice-only track so the Editor can swap music / remix without re-rendering
try { if (existsSync(join(ROOT, "public/voiceover.mp3"))) copyFileSync(join(ROOT, "public/voiceover.mp3"), join(ROOT, `out/${name}.voice.mp3`)); } catch {}
// keep the render config so the Editor can re-voice / change language later
try { copyFileSync(join(ROOT, "scenes.json"), join(ROOT, `out/${name}.config.json`)); } catch {}

// sidecar metadata for easy copy-paste when uploading to YouTube
const tags = Array.isArray(config.tags) ? config.tags : [];
writeFileSync(
  join(ROOT, `out/${name}.json`),
  JSON.stringify(
    {
      title: config.title || "",
      description: config.description || "",
      tags,
      hashtags: tags.map((t) => "#" + String(t).replace(/[^\p{L}\p{N}_]/gu, "")).join(" "),
    },
    null,
    2
  )
);
console.log(`\n✅ Saved: ${join(ROOT, outPath)}`);
