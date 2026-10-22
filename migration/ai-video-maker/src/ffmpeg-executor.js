// @ts-check

import { spawn } from 'node:child_process';

const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const SHELL_UNSAFE_PATH_PATTERN = /[\u0000-\u001f\u007f;&|$`<>()[\]{}\\'"*!?]/;
const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const LOCAL_FILE_URI_PATTERN = /^file:\/\//i;
const TRUNCATION_MARKER = '...[truncated]';

/**
 * @typedef {object} FfmpegExecutionReceipt
 * @property {string} started
 * @property {string} completed
 * @property {number|null} exitCode
 * @property {string} stdout
 * @property {string} stderr
 * @property {boolean} ok
 * @property {string[]|undefined} argv
 * @property {string|undefined} signal
 * @property {boolean|undefined} timedOut
 * @property {{code: string, message: string}|undefined} error
 */

/**
 * Validate and normalize an explicit local FFmpeg execution request.
 *
 * This helper is pure: it never checks the filesystem, starts a process, calls
 * a provider, or downloads a model. Planned mock/provider URIs remain valid for
 * planning, but are rejected here because this is the local execution boundary.
 *
 * @param {{argv: unknown, approval?: unknown, approved?: unknown, executionMode?: unknown, hardwareProfile?: unknown, renderPlan?: unknown, allowMockExecution?: boolean, timeoutMs?: number, maxOutputBytes?: number}} options
 * @returns {{argv: string[], executable: string, args: string[], timeoutMs: number, maxOutputBytes: number}}
 */
export function validateFfmpegExecution(options) {
  if (options === null || typeof options !== 'object') throw new TypeError('FFmpeg execution options must be an object');

  const argv = options.argv;
  if (!Array.isArray(argv) || argv.length < 2) {
    throw new TypeError('FFmpeg execution argv must contain an executable and at least one argument');
  }
  const normalizedArgv = argv.map((argument, index) => {
    if (typeof argument !== 'string' || argument.length === 0) {
      throw new TypeError(`FFmpeg argv[${index}] must be a non-empty string`);
    }
    if (argument.includes('\u0000')) throw new TypeError(`FFmpeg argv[${index}] must not contain null bytes`);
    return argument;
  });

  const approval = options.approval !== undefined
    ? options.approval
    : { approved: options.approved, executionMode: options.executionMode };
  if (approval === null || typeof approval !== 'object' || Array.isArray(approval)) {
    throw new Error('FFmpeg execution requires an approval object');
  }
  const approvalRecord = /** @type {Record<string, unknown>} */ (approval);
  const approved = approvalRecord.approved ?? options.approved;
  const executionMode = approvalRecord.executionMode ?? options.executionMode;
  if (approved !== true || executionMode !== 'local-ffmpeg') {
    throw new Error('FFmpeg execution requires approved:true and executionMode:"local-ffmpeg"');
  }

  const hardwareProfile = options.hardwareProfile;
  const hardwareExecution = hardwareProfile !== null && typeof hardwareProfile === 'object'
    ? /** @type {Record<string, unknown>} */ (hardwareProfile).execution
    : undefined;
  if (hardwareExecution === 'mock-only' && options.allowMockExecution !== true) {
    throw new Error('FFmpeg execution is refused for mock-only hardware unless allowMockExecution:true');
  }

  const renderPlan = options.renderPlan;
  if (renderPlan !== null && typeof renderPlan === 'object') {
    const plan = /** @type {Record<string, unknown>} */ (renderPlan);
    if (plan.requiresModelDownload === true) {
      throw new Error('FFmpeg execution is refused for a render plan that requires model downloads');
    }
  }

  const executable = assertSafeLocalPath(normalizedArgv[0], 'FFmpeg executable');
  for (const [index, argument] of normalizedArgv.entries()) {
    if (!index || !URI_SCHEME_PATTERN.test(argument)) continue;
    if (!LOCAL_FILE_URI_PATTERN.test(argument)) {
      throw new Error(`FFmpeg argv[${index}] contains a non-local URI`);
    }
    assertLocalFileUri(argument, `FFmpeg argv[${index}]`);
  }

  const inputIndexes = [];
  for (let index = 0; index < normalizedArgv.length; index += 1) {
    if (normalizedArgv[index] === '-i') {
      if (index + 1 >= normalizedArgv.length) throw new TypeError('FFmpeg input flag -i must have a value');
      inputIndexes.push(index + 1);
    }
  }
  if (inputIndexes.length === 0) throw new TypeError('FFmpeg argv must contain at least one local input');
  for (const index of inputIndexes) assertSafeLocalPath(normalizedArgv[index], `FFmpeg input ${index}`);
  assertSafeLocalPath(normalizedArgv.at(-1), 'FFmpeg output path');

  const timeoutMs = normalizePositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs');
  const maxOutputBytes = normalizePositiveInteger(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES, 'maxOutputBytes');
  return { argv: normalizedArgv, executable, args: normalizedArgv.slice(1), timeoutMs, maxOutputBytes };
}

/**
 * Execute a previously planned local FFmpeg argv array without a shell.
 *
 * Validation happens before spawn. The returned receipt contains only JSON-safe
 * values and bounds captured stdout/stderr to maxOutputBytes each.
 *
 * @param {Parameters<typeof validateFfmpegExecution>[0] & {cwd?: string, env?: NodeJS.ProcessEnv}} options
 * @returns {Promise<FfmpegExecutionReceipt>}
 */
export async function executeFfmpeg(options) {
  const request = validateFfmpegExecution(options);
  const started = new Date().toISOString();
  const child = spawn(request.executable, request.args, {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stdout = createOutputCapture(request.maxOutputBytes);
  const stderr = createOutputCapture(request.maxOutputBytes);
  child.stdout?.on('data', (chunk) => stdout.append(chunk));
  child.stderr?.on('data', (chunk) => stderr.append(chunk));

  return await new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, request.timeoutMs);

    const finish = (receipt) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(JSON.parse(JSON.stringify(receipt)));
    };

    child.once('error', (error) => {
      finish({
        started,
        completed: new Date().toISOString(),
        exitCode: null,
        stdout: stdout.value(),
        stderr: stderr.value(),
        ok: false,
        argv: request.argv,
        timedOut,
        error: {
          code: String(error.code ?? 'FFMPEG_EXECUTION_FAILED'),
          message: String(error.message ?? error),
        },
      });
    });
    child.once('close', (code, signal) => {
      finish({
        started,
        completed: new Date().toISOString(),
        exitCode: typeof code === 'number' ? code : null,
        stdout: stdout.value(),
        stderr: stderr.value(),
        ok: code === 0 && !timedOut,
        argv: request.argv,
        ...(signal ? { signal: String(signal) } : {}),
        ...(timedOut ? { timedOut: true } : {}),
      });
    });
  });
}

export const executeFfmpegCommand = executeFfmpeg;
export const validateLocalFfmpegExecution = validateFfmpegExecution;
export const executeLocalFfmpeg = executeFfmpeg;

/**
 * Validate every FFmpeg plan in a planned-only render manifest without
 * starting a process. The returned plan data is safe to print or review.
 *
 * @param {{manifest: unknown, approval?: unknown, approved?: unknown, executionMode?: unknown, allowMockExecution?: boolean, executablePath?: string, timeoutMs?: number, maxOutputBytes?: number}} options
 * @returns {{manifestVersion: unknown, projectId: unknown, executionStatus: 'planned_only', status: 'planned_only', planCount: number, plans: Array<Record<string, unknown>>}}
 */
export function validateRenderManifest(options) {
  const { manifest, requests } = collectRenderManifestRequests(options);
  return JSON.parse(JSON.stringify({
    manifestVersion: manifest.manifestVersion,
    projectId: manifest.projectId,
    executionStatus: 'planned_only',
    status: 'planned_only',
    planCount: requests.length,
    plans: requests.map(({ sceneId, request }) => ({
      ...(sceneId === undefined ? {} : { sceneId }),
      ...request,
    })),
  }));
}

export const validateLocalRenderManifest = validateRenderManifest;

/**
 * Execute every plan in a planned-only render manifest after validating all
 * plans up front. This keeps a malformed later plan from causing a partial run.
 *
 * @param {{manifest: unknown, approval?: unknown, approved?: unknown, executionMode?: unknown, allowMockExecution?: boolean, executablePath?: string, cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number, maxOutputBytes?: number}} options
 * @returns {Promise<Record<string, unknown>>}
 */
export async function executeRenderManifest(options) {
  const { manifest, requests } = collectRenderManifestRequests(options);

  const receipts = [];
  for (let index = 0; index < requests.length; index += 1) {
    receipts.push(await executeFfmpeg(requests[index].executionOptions));
  }
  const successful = receipts.every((receipt) => receipt.ok === true);
  return JSON.parse(JSON.stringify({
    manifestVersion: manifest.manifestVersion,
    projectId: manifest.projectId,
    executionStatus: successful ? 'completed' : 'failed',
    status: successful ? 'completed' : 'failed',
    receipts,
  }));
}

export const runRenderManifest = executeRenderManifest;

/**
 * @param {{manifest: unknown, approval?: unknown, approved?: unknown, executionMode?: unknown, allowMockExecution?: boolean, executablePath?: string, cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number, maxOutputBytes?: number}} options
 * @returns {{manifest: Record<string, unknown>, requests: Array<{sceneId?: string, request: Record<string, unknown>, executionOptions: Record<string, unknown>}>}}
 */
function collectRenderManifestRequests(options) {
  if (options?.manifest === null || typeof options?.manifest !== 'object' || Array.isArray(options.manifest)) {
    throw new TypeError('render manifest must be an object');
  }
  const manifest = /** @type {Record<string, unknown>} */ (options.manifest);
  if (manifest.executionStatus !== 'planned_only' || manifest.status !== 'planned_only') {
    throw new Error('render manifest must have planned_only execution status');
  }
  if (!Array.isArray(manifest.ffmpegPlans) || manifest.ffmpegPlans.length === 0) {
    throw new TypeError('render manifest must contain FFmpeg plans');
  }
  const common = { ...options, hardwareProfile: manifest.hardwareProfile };
  const requests = manifest.ffmpegPlans.map((value, index) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(`render manifest FFmpeg plan ${index + 1} must be an object`);
    }
    const plan = /** @type {Record<string, unknown>} */ (value);
    const plannedArgv = plan.argv ?? plan.command;
    if (!Array.isArray(plannedArgv)) throw new TypeError(`render manifest FFmpeg plan ${index + 1} must contain an argv array`);
    const argv = options.executablePath === undefined
      ? plannedArgv
      : [options.executablePath, ...plannedArgv.slice(1)];
    const renderPlan = plan.renderPlan ?? plan.plan ?? manifest.renderPlan;
    const request = validateFfmpegExecution({
      ...common,
      argv,
      renderPlan,
    });
    return {
      ...(typeof plan.sceneId === 'string' ? { sceneId: plan.sceneId } : {}),
      request: { ...request },
      executionOptions: {
        ...common,
        argv: request.argv,
        renderPlan,
      },
    };
  });
  return { manifest, requests };
}

/** @param {unknown} value @param {string} label @returns {string} */
function assertSafeLocalPath(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`);
  if (value !== value.trim()) throw new TypeError(`${label} must not have leading or trailing whitespace`);
  if (value.startsWith('-')) throw new TypeError(`${label} must not start with "-"`);
  if (SHELL_UNSAFE_PATH_PATTERN.test(value)) throw new TypeError(`${label} contains unsafe characters`);
  if (/(^|[/\\])\.\.([/\\]|$)/.test(value)) throw new TypeError(`${label} must not contain path traversal`);
  if (URI_SCHEME_PATTERN.test(value) && !LOCAL_FILE_URI_PATTERN.test(value)) {
    throw new Error(`${label} must be a local path or file:// URI`);
  }
  if (LOCAL_FILE_URI_PATTERN.test(value)) assertLocalFileUri(value, label);
  return value;
}

/** @param {string} value @param {string} label */
function assertLocalFileUri(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${label} must be a valid file:// URI`);
  }
  if (url.protocol !== 'file:' || (url.hostname !== '' && url.hostname !== 'localhost')) {
    throw new Error(`${label} must refer to a local file`);
  }
}

/** @param {unknown} value @param {number} fallback @param {string} label @returns {number} */
function normalizePositiveInteger(value, fallback, label) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
  return value;
}

/** @param {number} maxBytes */
function createOutputCapture(maxBytes) {
  /** @type {Buffer[]} */
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  return {
    /** @param {unknown} chunk */
    append(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      if (bytes >= maxBytes) {
        truncated = true;
        return;
      }
      const remaining = maxBytes - bytes;
      chunks.push(buffer.subarray(0, remaining));
      bytes += Math.min(buffer.length, remaining);
      if (buffer.length > remaining) truncated = true;
    },
    value() {
      const value = Buffer.concat(chunks).toString('utf8');
      return truncated ? truncateOutput(`${value}${TRUNCATION_MARKER}`, maxBytes) : value;
    },
  };
}

/** @param {string} value @param {number} maxBytes */
function truncateOutput(value, maxBytes) {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  const markerBytes = Buffer.byteLength(TRUNCATION_MARKER, 'utf8');
  if (maxBytes <= markerBytes) return TRUNCATION_MARKER.slice(0, maxBytes);
  const prefix = Buffer.from(value, 'utf8').subarray(0, Math.max(0, maxBytes - markerBytes)).toString('utf8').replace(/\uFFFD$/, '');
  return `${prefix}${TRUNCATION_MARKER}`;
}
