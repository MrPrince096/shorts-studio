// One-shot: build (TTS + Pexels + timings) then render to a title-named MP4 in out/
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
console.log(`\n✅ Saved: ${join(ROOT, outPath)}`);
