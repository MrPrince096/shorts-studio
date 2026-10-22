// @ts-check

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { selectHardwareProfile } from './hardware.js';
import { planRender } from './render-planner.js';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_BUFFER = 2 * 1024 * 1024;

/**
 * Parse the tabular output of `ffmpeg -hide_banner -encoders`.
 *
 * This function is pure and only returns encoder names from rows that begin
 * with FFmpeg's six-character capability flags. It does not execute FFmpeg.
 *
 * @param {string} output
 * @returns {string[]}
 */
export function parseFfmpegEncoderOutput(output) {
  if (typeof output !== 'string') throw new TypeError('FFmpeg encoder output must be a string');
  const encoders = [];
  const seen = new Set();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*[A-Z.]{6}\s+([A-Za-z0-9_][A-Za-z0-9_.-]*)/.exec(line);
    if (!match) continue;
    const encoder = match[1].trim().toLowerCase();
    if (!seen.has(encoder)) {
      seen.add(encoder);
      encoders.push(encoder);
    }
  }
  return encoders;
}

export const parseEncoderOutput = parseFfmpegEncoderOutput;
export const parseFfmpegEncoders = parseFfmpegEncoderOutput;

/**
 * Compare a planned-only render manifest with detected FFmpeg encoders.
 *
 * @param {unknown} manifest
 * @param {string[]|{availableEncoders?: string[]}} detected
 * @returns {{compatible: boolean, matches: boolean, plannedOnly: boolean, plannedCodecs: string[], detectedEncoders: string[], missingEncoders: string[], checks: Array<{codec: string, available: boolean, sceneId?: string}>}}
 */
export function compareRenderManifestEncoders(manifest, detected) {
  const availableEncoders = Array.isArray(detected)
    ? detected
    : detected?.availableEncoders ?? detected?.detectedEncoders ?? detected?.encoders ?? [];
  const detectedEncoders = normalizeEncoders(availableEncoders);
  const detectedSet = new Set(detectedEncoders);
  const record = isRecord(manifest) ? manifest : {};
  const plannedOnly = record.executionStatus === 'planned_only' && record.status === 'planned_only';
  const checks = [];
  const plannedCodecs = [];

  addCheck(record.renderPlan?.codec, undefined);
  if (Array.isArray(record.ffmpegPlans)) {
    for (const plan of record.ffmpegPlans) {
      if (!isRecord(plan)) continue;
      addCheck(plan.renderPlan?.codec ?? plan.plan?.codec, typeof plan.sceneId === 'string' ? plan.sceneId : undefined);
    }
  }

  const missingEncoders = [...new Set(checks.filter((check) => !check.available).map((check) => check.codec))];
  return {
    compatible: plannedOnly && missingEncoders.length === 0,
    matches: missingEncoders.length === 0,
    plannedOnly,
    plannedCodecs,
    detectedEncoders,
    missingEncoders,
    checks,
  };

  /** @param {unknown} codec @param {string|undefined} [sceneId] */
  function addCheck(codec, sceneId) {
    if (typeof codec !== 'string' || codec.trim() === '') return;
    const normalizedCodec = codec.trim().toLowerCase();
    if (!plannedCodecs.includes(normalizedCodec)) plannedCodecs.push(normalizedCodec);
    checks.push({ codec: normalizedCodec, available: detectedSet.has(normalizedCodec), ...(sceneId ? { sceneId } : {}) });
  }
}

export const compareManifestEncoders = compareRenderManifestEncoders;
export const checkRenderManifestEncoders = compareRenderManifestEncoders;
export const compareRenderManifest = compareRenderManifestEncoders;

/**
 * Build a JSON-safe capability report from already detected encoders.
 * This is pure and uses the existing render planner for codec selection.
 *
 * @param {{platform?: string, hardwareProfile?: string|{id?: string, modelDownloads?: unknown[]}, availableEncoders?: string[], renderManifest?: unknown, ffmpeg?: Record<string, unknown>}} [options]
 */
export function buildCapabilityReport({
  platform = process.platform,
  hardwareProfile = selectHardwareProfile('m1-lite'),
  availableEncoders = [],
  renderManifest,
  ffmpeg = {},
} = {}) {
  const normalizedEncoders = normalizeEncoders(availableEncoders);
  const selectedProfile = typeof hardwareProfile === 'string' ? selectHardwareProfile(hardwareProfile) : hardwareProfile;
  const renderPlan = planRender({ platform, hardwareProfile: selectedProfile, availableEncoders: normalizedEncoders });
  const comparison = renderManifest === undefined
    ? undefined
    : compareRenderManifestEncoders(renderManifest, normalizedEncoders);

  return JSON.parse(JSON.stringify({
    auditVersion: 1,
    executionStatus: 'planned_only',
    platform: String(platform),
    hardwareProfile: selectedProfile,
    detectedEncoders: normalizedEncoders,
    availableEncoders: normalizedEncoders,
    renderPlan,
    ffmpeg: { ...ffmpeg },
    ...(typeof ffmpeg.available === 'boolean' ? { ffmpegAvailable: ffmpeg.available } : {}),
    ...(comparison ? { manifestComparison: comparison } : {}),
  }));
}

export const createCapabilityReport = buildCapabilityReport;

/**
 * Run one bounded, read-only FFmpeg encoder listing and produce a report.
 * No render, model download, provider request, or shell command is involved.
 *
 * @param {{ffmpegPath?: string, platform?: string, hardwareProfile?: string|{id?: string, modelDownloads?: unknown[]}, renderManifest?: unknown, timeoutMs?: number}} [options]
 */
export async function auditFfmpegCapabilities({
  ffmpegPath = 'ffmpeg',
  platform = process.platform,
  hardwareProfile = selectHardwareProfile('m1-lite'),
  renderManifest,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  assertExecutable(ffmpegPath);
  const boundedTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.min(Math.floor(timeoutMs), DEFAULT_TIMEOUT_MS)
    : DEFAULT_TIMEOUT_MS;
  const command = [ffmpegPath, '-hide_banner', '-encoders'];

  try {
    const result = await execFileAsync(ffmpegPath, command.slice(1), {
      timeout: boundedTimeout,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
    });
    const availableEncoders = parseFfmpegEncoderOutput(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
    return buildCapabilityReport({
      platform,
      hardwareProfile,
      availableEncoders,
      renderManifest,
      ffmpeg: { path: ffmpegPath, available: true, command, timedOut: false },
    });
  } catch (error) {
    const errorRecord = /** @type {NodeJS.ErrnoException & {killed?: boolean, signal?: string}} */ (error);
    return buildCapabilityReport({
      platform,
      hardwareProfile,
      availableEncoders: [],
      renderManifest,
      ffmpeg: {
        path: ffmpegPath,
        available: false,
        command,
        timedOut: errorRecord.killed === true || errorRecord.code === 'ETIMEDOUT',
        error: {
          code: String(errorRecord.code ?? 'FFMPEG_PROBE_FAILED'),
          message: String(errorRecord.message ?? error),
        },
      },
    });
  }
}

export const auditCapabilities = auditFfmpegCapabilities;

/** @param {string} filePath @param {unknown} manifest @returns {Promise<Record<string, unknown>>} */
export async function writeCapabilityReport(filePath, manifest) {
  assertExecutable(filePath, 'capability report path');
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return /** @type {Record<string, unknown>} */ (manifest);
}

/** @param {string} filePath @returns {Promise<unknown>} */
export async function readRenderManifest(filePath) {
  assertExecutable(filePath, 'render manifest path');
  return JSON.parse(await readFile(filePath, 'utf8'));
}

/** @param {string[]} encoders @returns {string[]} */
function normalizeEncoders(encoders) {
  if (!Array.isArray(encoders)) throw new TypeError('availableEncoders must be an array');
  return [...new Set(encoders.map((encoder) => String(encoder).trim().toLowerCase()).filter(Boolean))];
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value @param {string} [label] */
function assertExecutable(value, label = 'FFmpeg executable') {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`);
  if (value.includes('\u0000')) throw new TypeError(`${label} must not contain null bytes`);
}
