// Hardware-aware auto-configuration.
//
// Scans the Mac (chip family, RAM, CPU/GPU cores) and picks a "tier" that
// decides how hard the local AI stack is allowed to push: which models to
// download, image resolution + step caps, and video clip length/fps. On an
// M1/16GB this stays lite; on an M5 Ultra / M6 / 128GB+ it unlocks the big
// settings. The same code therefore adapts to whatever Mac it's installed on.
import { execFileSync } from "node:child_process";
import os from "node:os";

const GB = 1024 * 1024 * 1024;

function sysctl(key) {
  try { return execFileSync("sysctl", ["-n", key], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return ""; }
}

// GPU core count needs system_profiler (~1-2s). Optional — only read on the
// full scan, never on the hot path.
function gpuCores() {
  try {
    const out = execFileSync("system_profiler", ["SPDisplaysDataType"], { stdio: ["ignore", "pipe", "ignore"], timeout: 8000 }).toString();
    const m = out.match(/Total Number of Cores:\s*(\d+)/i);
    if (m) return parseInt(m[1], 10);
  } catch {}
  return 0;
}

// Turn "Apple M3 Max" / "Apple M1" / "Apple M5 Ultra" into { gen, variant }.
function parseChip(brand) {
  const s = String(brand || "");
  const gm = s.match(/\bM(\d+)\b/i);
  const gen = gm ? parseInt(gm[1], 10) : 0;
  let variant = "base";
  if (/ultra/i.test(s)) variant = "ultra";
  else if (/max/i.test(s)) variant = "max";
  else if (/pro/i.test(s)) variant = "pro";
  return { gen, variant, label: s || "Unknown CPU" };
}

// A single number that captures "how much can this Mac take". Chip generation
// and variant dominate; RAM gates whether the bigger models even fit.
function computePower(chip, ramGB) {
  const genScore = chip.gen ? (chip.gen - 1) * 12 : 0;       // M1=0, M2=12, M3=24, M5=48…
  const variantScore = { base: 0, pro: 14, max: 26, ultra: 44 }[chip.variant] || 0;
  const ramScore = Math.min(ramGB, 256) * 0.6;               // ~10 at 16GB, ~38 at 64GB
  return Math.round(genScore + variantScore + ramScore);
}

// Tier presets. Each preset is the *ceiling* for that class of machine — the
// generation code reads these caps instead of hard-coding 768px / 2s clips.
const TIERS = {
  lite: {
    id: "lite",
    name: "Lite",
    blurb: "Tuned for 8-16GB Apple Silicon. Fast, light models; short clips.",
    image: { model: "SDXL-Lightning (4-step)", steps: 4, maxDim: 768, batch: 1 },
    video: { model: "LTX-Video 2B (distilled)", maxSeconds: 3, fps: 24, maxDim: 512 },
    concurrency: 1,
    keepModelsWarm: false,
  },
  standard: {
    id: "standard",
    name: "Standard",
    blurb: "For M-series Pro/Max or 32GB+. Full-quality images, longer clips.",
    image: { model: "SDXL (full) + Lightning LoRA", steps: 8, maxDim: 1024, batch: 1 },
    video: { model: "LTX-Video 2B (distilled)", maxSeconds: 5, fps: 25, maxDim: 704 },
    concurrency: 1,
    keepModelsWarm: true,
  },
  pro: {
    id: "pro",
    name: "Pro",
    blurb: "For Max/Ultra or 64GB+. High-res images, multi-second HD clips.",
    image: { model: "SDXL (full), 25 steps", steps: 25, maxDim: 1280, batch: 2 },
    video: { model: "LTX-Video 2B, longer horizon", maxSeconds: 8, fps: 30, maxDim: 768 },
    concurrency: 2,
    keepModelsWarm: true,
  },
  ultra: {
    id: "ultra",
    name: "Ultra",
    blurb: "For M-Ultra / M5+ / 128GB+. Everything unlocked, longest clips.",
    image: { model: "SDXL (full), 30 steps, hi-res fix", steps: 30, maxDim: 1536, batch: 3 },
    video: { model: "LTX-Video 2B, HD, long horizon", maxSeconds: 12, fps: 30, maxDim: 1024 },
    concurrency: 3,
    keepModelsWarm: true,
  },
};

function tierForPower(power, ramGB) {
  // RAM is a hard gate — no chip is allowed above its memory budget.
  if (power >= 70 && ramGB >= 96) return "ultra";
  if (power >= 48 && ramGB >= 48) return "pro";
  if (power >= 26 && ramGB >= 28) return "standard";
  return "lite";
}

// Model download plan the setup screen shows. Sizes are approximate on-disk.
function downloadPlan(tierId) {
  const base = [
    { key: "sdxl", label: "SDXL base checkpoint", size: "6.9 GB", for: "images", tiers: ["lite", "standard", "pro", "ultra"] },
    { key: "sdxl-lightning", label: "SDXL Lightning 4-step LoRA", size: "0.4 GB", for: "fast images", tiers: ["lite", "standard", "pro", "ultra"] },
    { key: "ltx", label: "LTX-Video 2B (distilled)", size: "3.9 GB", for: "video clips", tiers: ["lite", "standard", "pro", "ultra"] },
    { key: "t5xxl", label: "T5-XXL text encoder (fp8)", size: "4.9 GB", for: "video prompts", tiers: ["lite", "standard", "pro", "ultra"] },
    { key: "kokoro", label: "Kokoro voices (ONNX)", size: "0.3 GB", for: "voice", tiers: ["lite", "standard", "pro", "ultra"] },
    { key: "xtts", label: "XTTS v2 (voice cloning)", size: "1.8 GB", for: "voice cloning", tiers: ["standard", "pro", "ultra"] },
  ];
  return base
    .filter((m) => m.tiers.includes(tierId))
    .map(({ tiers, ...m }) => m);
}

let _cache = null;

// Full scan (includes the slow GPU probe). Cached for the process lifetime.
export function detectHardware({ fresh = false } = {}) {
  if (_cache && !fresh) return _cache;
  const isMac = process.platform === "darwin";
  const brand = isMac ? (sysctl("machdep.cpu.brand_string") || os.cpus()?.[0]?.model || "") : (os.cpus()?.[0]?.model || "");
  const isAppleSilicon = isMac && sysctl("hw.optional.arm64") === "1";
  const chip = parseChip(brand);
  const ramBytes = Number(sysctl("hw.memsize")) || os.totalmem();
  const ramGB = Math.round(ramBytes / GB);
  const cpuCores = parseInt(sysctl("hw.ncpu"), 10) || os.cpus()?.length || 0;
  const gpu = isAppleSilicon ? gpuCores() : 0;
  const power = computePower(chip, ramGB);
  const tierId = isAppleSilicon ? tierForPower(power, ramGB) : "lite";
  const tier = TIERS[tierId];

  _cache = {
    scannedAt: new Date().toISOString(),
    platform: process.platform,
    isMac,
    isAppleSilicon,
    chip: chip.label,
    chipGen: chip.gen,
    chipVariant: chip.variant,
    ramGB,
    cpuCores,
    gpuCores: gpu,
    powerScore: power,
    tier,
    tierId,
    allTiers: Object.values(TIERS).map((t) => ({ id: t.id, name: t.name, blurb: t.blurb })),
    downloads: downloadPlan(tierId),
    // A one-line, human summary the UI can show verbatim.
    summary: isAppleSilicon
      ? `${chip.label} · ${ramGB}GB RAM${gpu ? ` · ${gpu}-core GPU` : ""} → ${tier.name} tier`
      : `${brand || "This computer"} · ${ramGB}GB RAM → Lite (Apple Silicon recommended for local AI)`,
  };
  return _cache;
}

// The caps the generation code should obey, for a given (optionally overridden)
// tier. `override` lets a user force a lighter/heavier tier from the UI.
export function tierConfig(override) {
  const hw = detectHardware();
  const id = (override && TIERS[override]) ? override : hw.tierId;
  return TIERS[id];
}
