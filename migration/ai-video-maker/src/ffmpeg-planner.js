// @ts-check

const SUPPORTED_CODECS = new Set(['h264_videotoolbox', 'h264_nvenc', 'libx264']);
const UNSAFE_ARGUMENT_PATTERN = /[\u0000-\u001f\u007f;&|$`<>()[\]{}\\'"*!?]/;

/**
 * @typedef {import('./render-planner.js').RenderPlan} RenderPlan
 */

/**
 * @typedef {object} FfmpegCommandPlan
 * @property {RenderPlan} renderPlan
 * @property {string[]} argv
 * @property {{width: number, height: number}} dimensions
 * @property {number} fps
 * @property {string[]} inputArtifacts
 * @property {string[]} audioInputs
 * @property {string[]} captionInputs
 * @property {string} outputPath
 */

/**
 * Build an FFmpeg argv array without invoking a process or interpolating a shell.
 *
 * Every path/URI is kept as its own argv item. The result is JSON-serializable and
 * can be reviewed or handed to a separately controlled process by a later adapter.
 *
 * @param {{
 *   renderPlan: RenderPlan,
 *   dimensions: {width: number, height: number},
 *   fps: number,
 *   inputArtifacts?: Array<string|{uri?: string}>,
 *   inputs?: Array<string|{uri?: string}>,
 *   audioInputs?: Array<string|{uri?: string}>,
 *   captionInputs?: Array<string|{uri?: string}>,
 *   outputPath: string,
 *   ffmpegPath?: string,
 * }} options
 * @returns {FfmpegCommandPlan}
 */
export function planFfmpegCommand(options) {
  const renderPlan = assertRenderPlan(options?.renderPlan);
  const dimensions = assertDimensions(options?.dimensions);
  const fps = assertFps(options?.fps);
  const inputArtifacts = normalizeInputs(options?.inputArtifacts ?? options?.inputs, 'input artifact');
  const audioInputs = normalizeInputs(options?.audioInputs, 'audio input', { optional: true });
  const captionInputs = normalizeInputs(options?.captionInputs, 'caption input', { optional: true });
  const outputPath = assertSafeArgument(options?.outputPath, 'output path');
  const ffmpegPath = assertSafeArgument(options?.ffmpegPath ?? 'ffmpeg', 'FFmpeg executable');

  const argv = [ffmpegPath, '-hide_banner', '-y'];
  for (const input of [...inputArtifacts, ...audioInputs, ...captionInputs]) {
    argv.push('-i', input);
  }

  const audioStart = inputArtifacts.length;
  const captionStart = audioStart + audioInputs.length;
  argv.push('-map', '0:v:0');
  for (let index = 0; index < audioInputs.length; index += 1) {
    argv.push('-map', `${audioStart + index}:a:0?`);
  }
  for (let index = 0; index < captionInputs.length; index += 1) {
    argv.push('-map', `${captionStart + index}:s:0?`);
  }

  argv.push(
    '-vf',
    `scale=${dimensions.width}:${dimensions.height}:force_original_aspect_ratio=decrease,pad=${dimensions.width}:${dimensions.height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
    '-r',
    String(fps),
    '-c:v',
    renderPlan.codec,
  );

  if (renderPlan.codec === 'h264_videotoolbox') {
    argv.push('-allow_sw', '1', '-pix_fmt', 'yuv420p');
  } else if (renderPlan.codec === 'h264_nvenc') {
    argv.push('-preset', 'p4', '-rc', 'vbr', '-cq', '23', '-pix_fmt', 'yuv420p');
  } else {
    argv.push('-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p');
  }

  if (audioInputs.length > 0) argv.push('-c:a', 'aac', '-b:a', '192k');
  if (captionInputs.length > 0) argv.push('-c:s', 'mov_text');
  if (audioInputs.length > 0) argv.push('-shortest');
  argv.push('-movflags', '+faststart', outputPath);

  return {
    renderPlan: { ...renderPlan },
    argv,
    dimensions: { ...dimensions },
    fps,
    inputArtifacts: [...inputArtifacts],
    audioInputs: [...audioInputs],
    captionInputs: [...captionInputs],
    outputPath,
  };
}

export const planFfmpegRender = planFfmpegCommand;
export const createFfmpegCommandPlan = planFfmpegCommand;

/**
 * Convenience form for callers that only need the child-process argv array.
 * @param {Parameters<typeof planFfmpegCommand>[0]} options
 * @returns {string[]}
 */
export function planFfmpegArgv(options) {
  return planFfmpegCommand(options).argv;
}

export const buildFfmpegArgv = planFfmpegArgv;

/** @param {unknown} value @returns {RenderPlan} */
function assertRenderPlan(value) {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('renderPlan must be an object');
  }
  const plan = /** @type {Record<string, unknown>} */ (value);
  if (!SUPPORTED_CODECS.has(String(plan.codec))) {
    throw new RangeError(`Unsupported render codec: ${String(plan.codec)}`);
  }
  return /** @type {RenderPlan} */ ({
    codec: String(plan.codec),
    hardwareAcceleration: plan.hardwareAcceleration === true,
    reason: String(plan.reason ?? ''),
    requiresModelDownload: plan.requiresModelDownload === true,
  });
}

/** @param {unknown} value @returns {{width: number, height: number}} */
function assertDimensions(value) {
  if (value === null || typeof value !== 'object') throw new TypeError('dimensions must be an object');
  const dimensions = /** @type {Record<string, unknown>} */ (value);
  const width = dimensions.width;
  const height = dimensions.height;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError('dimensions must contain positive integer width and height');
  }
  return { width, height };
}

/** @param {unknown} value @returns {number} */
function assertFps(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError('fps must be a positive finite number');
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} label
 * @param {{optional?: boolean}} [options]
 * @returns {string[]}
 */
function normalizeInputs(value, label, { optional = false } = {}) {
  if (value === undefined && optional) return [];
  if (!Array.isArray(value)) throw new TypeError(`${label}s must be an array`);
  if (!optional && value.length === 0) throw new RangeError(`${label}s must contain at least one item`);
  return value.map((item, index) => {
    const candidate = typeof item === 'string' ? item : item?.uri ?? item?.path;
    return assertSafeArgument(candidate, `${label} ${index + 1}`);
  });
}

/** @param {unknown} value @param {string} label @returns {string} */
function assertSafeArgument(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`);
  if (value !== value.trim()) throw new TypeError(`${label} must not have leading or trailing whitespace`);
  if (value.startsWith('-')) throw new TypeError(`${label} must not start with "-"`);
  if (UNSAFE_ARGUMENT_PATTERN.test(value)) throw new TypeError(`${label} contains unsafe characters`);
  return value;
}
