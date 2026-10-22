# AI Video Maker migration scaffold

This is a small, dependency-free migration scaffold for the approved AI Video Maker product. It is intentionally runnable with Node.js alone: there are no model downloads, provider credentials, network calls, or heavyweight dependencies.

## Run it

Requirements: Node.js 20 or newer.

```bash
npm test
npm start
npm start -- --render-manifest /tmp/ai-video-render-manifest.json
```

`npm start` runs one deterministic demo in a temporary directory and prints the generated artifact manifest. `npm test` uses Node's built-in `node:test` runner.

### Explicit local FFmpeg execution

Rendering remains `planned_only` unless a caller opts in. The execution boundary
accepts only an argv array, uses `child_process.spawn` with `shell: false`,
rejects HTTP/HTTPS and other non-local URIs, rejects unsafe local paths, and
requires an approval object containing both `{"approved": true, "executionMode":
"local-ffmpeg"}`. It also refuses the default `mock-only` hardware profile unless
`--allow-mock-execution` is explicitly supplied. It never downloads models or
calls providers.

To execute a reviewed manifest, every `ffmpegPlans[*].argv` must contain local
input and output file paths. The default pipeline's `mock://` artifact URIs are
intentionally refused by this boundary; replace them with reviewed local paths
before execution. Create a separate approval JSON file, validate the manifest,
then run the approved command:

```bash
printf '{"approved":true,"executionMode":"local-ffmpeg"}\n' > /tmp/ffmpeg-approval.json
npm start -- --validate-render \
  --render-manifest /absolute/path/to/local-render-manifest.json \
  --execution-approval /tmp/ffmpeg-approval.json
npm start -- --execute-render \
  --render-manifest /absolute/path/to/local-render-manifest.json \
  --execution-approval /tmp/ffmpeg-approval.json
```

The reviewed manifest should keep `executionStatus` and `status` set to
`"planned_only"`, use a local hardware profile, and contain paths such as
`/absolute/path/to/input.mp4` and `/absolute/path/to/output.mp4` in its argv.
This workflow executes a local FFmpeg process against local filesystem paths
only. Do not use `http://`, `https://`, `s3://`, `mock://`, or another network or
provider URI; validation refuses them. Use `--ffmpeg /path/to/ffmpeg` when the
manifest's executable needs to be replaced with a local FFmpeg installation.

`--validate-render` is a side-effect-free check: it validates the planned-only
manifest, local path boundaries, render plan restrictions, and approval JSON but
does not start FFmpeg. Without `--execute-render`, the CLI only plans, exports,
or validates; without the approval file, execution and validation are refused.

The command prints a JSON-safe receipt for each planned FFmpeg command with
`started`, `completed`, `exitCode`, bounded `stdout`, bounded `stderr`, and
success/error fields.

Library callers can use the pure `validateFfmpegExecution` and
`validateRenderManifest` helpers and the async `executeFfmpeg` function exported
from `src/index.js`, or execute all plans in a manifest with
`executeRenderManifest`.

### Local capability audit

Run the optional local FFmpeg capability audit explicitly when you want to inspect the host. It runs only the bounded, read-only command `ffmpeg -hide_banner -encoders`; it never renders, downloads models, or contacts providers:

```bash
npm start -- --capability-audit
npm start -- --capability-audit --ffmpeg /path/to/ffmpeg
```

The report uses `planRender` with the detected encoders, and safely reports `ffmpeg.available: false` with a software `libx264` fallback when FFmpeg is unavailable. Compare a previously exported planned-only manifest with the detected encoders and optionally write the JSON report:

```bash
npm start -- --capability-audit \
  --render-manifest /tmp/ai-video-render-manifest.json \
  --capability-report /tmp/ai-video-capability-report.json
```

The pure helpers `parseFfmpegEncoderOutput`, `buildCapabilityReport`, and `compareRenderManifestEncoders` are exported from `src/index.js` for local tooling and tests.

### Review before execution

The pipeline remains mock-only and never starts FFmpeg. After a completed run, use `--render-manifest` to export a JSON-only render plan for review:

```bash
npm start -- --render-manifest /tmp/ai-video-render-manifest.json
```

For an imported scenes file, the manifest is written only after explicit approval and completion:

```bash
npm start -- --scenes path/to/scenes.json --checkpoint path/to/checkpoint.json --approve \
  --render-manifest path/to/render-manifest.json
```

Inspect the manifest's `hardwareProfile`, `renderPlan`, and `ffmpegPlans[*].argv` before handing those argv arrays to a separately reviewed render executor. The manifest has `executionStatus: "planned_only"`; exporting it does not execute FFmpeg, download models, or change mock-provider behavior.

### Import a scenes.json file

The file bridge reads one local JSON file, converts it through the existing Short Studio adapter, runs the cheap script stage, and persists checkpoints and approvals. It will stop with `awaiting_approval` before voice, captions, visuals, or render mock providers run:

```bash
npm start -- --scenes path/to/scenes.json --checkpoint path/to/checkpoint.json
```

Resume with an explicit approval flag:

```bash
npm start -- --scenes path/to/scenes.json --checkpoint path/to/checkpoint.json --approve
```

The approval state is stored beside the checkpoint by default. Use `--approval path/to/approvals.json` to choose that persisted gate file. An explicit JSON decision file can be supplied instead with `--approval-file path/to/decision.json`; it accepts `true` or an object such as `{"approved": true, "decidedBy": "reviewer"}`. The command prints the imported project, pipeline result, and a serializable `summary` containing job status, stage status, approval, and checkpoint data.

## Included design

- `src/models.js` and `src/models.d.ts` define JSON-compatible project, scene, asset, timeline clip, generation job, stage, approval, and artifact shapes. The JavaScript factories provide small runtime defaults; the declaration file gives TypeScript consumers explicit interfaces.
- `src/checkpoint-store.js` provides an atomic JSON checkpoint store for project stages and individual scenes. A new process can reopen the file and skip completed work.
- `src/approval-gate.js` persists pending/approved/rejected decisions. The pipeline completes the cheap script stage, then requires a human approval for `voice` before any voice, caption, visual, or render provider is invoked.
- `src/hardware.js` selects the `m1-lite` profile by default. Its `modelDownloads` list is deliberately empty and its execution mode is `mock-only`.
- `src/providers.js` defines deterministic provider-neutral adapters for script, voice, captions, visuals, and render. Replace an adapter with a real implementation without changing the pipeline contract.
- `src/render-planner.js` provides a pure, JSON-serializable FFmpeg capability planner. It prefers `h264_videotoolbox` for Apple Silicon, uses `h264_nvenc` only on non-Apple platforms, and otherwise falls back to `libx264`; the `m1-lite` profile always reports `requiresModelDownload: false`.
- `src/ffmpeg-planner.js` converts a render capability plan, dimensions, FPS, artifact paths/URIs, optional audio/caption inputs, and an output path into a safe JSON-serializable FFmpeg argv array. It validates every executable/path argument, applies codec-specific VideoToolbox, NVENC, or libx264 flags, and never starts FFmpeg.
- `src/pipeline.js` coordinates resumable stage/scene execution and returns an artifact manifest.
- `src/short-studio-adapter.js` converts an in-memory Short Studio-like `scenes.json` mapping into the scaffold's `Project`, `Scene`, `Asset`, and `TimelineClip` shapes. It preserves title, dimensions, voice, scene text/query, and timing in model fields and asset metadata, and performs no file or network I/O.
- `src/file-bridge.js` is the local JSON-only boundary around that adapter and `VideoPipeline`. It imports a file, persists a pending/approved voice decision, runs the script checkpoint before pausing, resumes from checkpoints after explicit approval, and exposes a JSON-safe job-status/checkpoint summary.

## Migration integration map

The scaffold is an orchestration boundary rather than a copy of another project:

### Short Studio

Short Studio can own the user-facing project editor, scene ordering, timeline editing, and review UI. It can serialize its project into the `Project`, `Scene`, `Asset`, and `TimelineClip` shapes, call `JsonApprovalGate.request()` when a script is ready, and display checkpoint/job status while `VideoPipeline` resumes work.

The clean-room boundary for a serialized scene mapping is:

```js
import { adaptShortStudioScenesJson } from './src/short-studio-adapter.js';

const project = adaptShortStudioScenesJson({
  title: 'Launch story',
  dimensions: { width: 1080, height: 1920 },
  voice: 'en-us-female',
  scenes: {
    intro: { text: 'Welcome', query: 'bright studio', start: 0, duration: 4 },
  },
});
```

The function accepts an already parsed object only. `start`/`duration` values are seconds, while explicit `startMs`/`durationMs` values are milliseconds. Dimensions must be positive integers and at least one scene is required. The adapter creates deterministic opaque `short-studio://` asset URIs; it does not open `scenes.json`, resolve media, or call a service.

### Velorn concepts

Velorn-style concepts map naturally to explicit generation jobs, stage boundaries, provider adapters, artifacts, and approvals. The checkpoint store is the persistence seam for a future durable job runner; the current implementation remains local and deterministic so migration work can be tested without credentials.

### OpenVideoStudio concepts

OpenVideoStudio-style timeline composition maps to `TimelineClip`, scene-level artifacts, and the render provider contract. A production adapter can translate those clips into an FFmpeg or editor-specific render graph while keeping the model and approval boundary stable.

## License and attribution boundaries

This scaffold contains only original migration glue and deterministic mock implementations. It does not copy GPL source code or link to GPL code. Keep any GPL-covered Short Studio/OpenVideoStudio-derived implementation isolated behind a separately reviewed adapter or process boundary, preserve its license and source notices, and do not combine copied GPL implementation files into this scaffold without an explicit compatibility review.

Apache- and MIT-licensed concepts or dependencies may be incorporated only with their original license text, copyright notices, and required attribution retained. This repository currently has no third-party runtime dependencies, so there are no bundled Apache/MIT notices to install. Product concepts and interface ideas are represented as clean-room data contracts; implementation provenance should be recorded when a future adapter is added.

## Production seams

1. Replace JSON files with the product's durable storage while retaining the checkpoint and approval method contracts.
2. Add an authenticated approval UI and map reviewer identity to `decidedBy`.
3. Implement provider adapters behind the methods in `src/providers.js`.
4. Add a real render adapter and artifact storage; keep model downloads out of the M1 Lite profile unless separately approved.

### Safe render capability planning

The planner accepts a platform, hardware profile, and the FFmpeg encoder names available to the render process:

```js
import { planRender } from './src/index.js';

const renderPlan = planRender({
  platform: 'darwin',
  hardwareProfile: { id: 'm1-lite', modelDownloads: [] },
  availableEncoders: ['libx264', 'h264_videotoolbox'],
});
// {
//   codec: 'h264_videotoolbox',
//   hardwareAcceleration: true,
//   reason: 'Apple Silicon VideoToolbox is available and is the preferred hardware encoder.',
//   requiresModelDownload: false,
// }
```

The function performs no host probing, FFmpeg execution, or model downloads, so callers can inspect the plan before starting a render.

### Safe FFmpeg argv planning

Build a command plan separately from execution:

```js
import { planFfmpegCommand } from './src/index.js';

const command = planFfmpegCommand({
  renderPlan,
  dimensions: { width: 1080, height: 1920 },
  fps: 30,
  inputArtifacts: ['file:///tmp/visual.png'],
  audioInputs: ['file:///tmp/voice.wav'],
  captionInputs: ['file:///tmp/captions.json'],
  outputPath: 'file:///tmp/output.mp4',
});
// command.argv is ['ffmpeg', ...] with every value kept as a separate argument.
// The planner validates paths and never invokes a child process.
```

`VideoPipeline` retains its deterministic mock render behavior and includes `renderPlan` plus one `ffmpegPlans` entry per rendered scene in its JSON-serializable result. Each entry contains the selected codec plan and the planned `command` argv array for inspection by a future render adapter.
