// @ts-check

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * @typedef {object} RenderManifest
 * @property {1} manifestVersion
 * @property {string} projectId
 * @property {Record<string, unknown>} hardwareProfile
 * @property {Record<string, unknown>} renderPlan
 * @property {Array<{sceneId: string, renderPlan: Record<string, unknown>, argv: string[]}>} ffmpegPlans
 * @property {'planned_only'} executionStatus
 * @property {'planned_only'} status
 */

/**
 * Turn a completed VideoPipeline result into a reviewable, JSON-only render
 * manifest. This function only copies data and validates argv boundaries; it
 * never starts FFmpeg or any other process.
 *
 * @param {unknown} result
 * @returns {RenderManifest}
 */
export function exportRenderManifest(result) {
  assertJsonValue(result, 'result');
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    throw new TypeError('pipeline result must be an object');
  }

  const pipelineResult = /** @type {Record<string, unknown>} */ (result);
  if (pipelineResult.status !== 'completed') {
    throw new Error('render manifest requires a completed pipeline result');
  }

  const projectId = assertNonEmptyString(pipelineResult.projectId, 'result.projectId');
  const hardwareProfile = assertRecord(pipelineResult.hardwareProfile, 'result.hardwareProfile');
  const renderPlan = assertRecord(pipelineResult.renderPlan, 'result.renderPlan');
  const ffmpegPlans = pipelineResult.ffmpegPlans;
  if (!Array.isArray(ffmpegPlans)) {
    throw new TypeError('result.ffmpegPlans must be an array');
  }

  const manifestPlans = ffmpegPlans.map((value, index) => {
    const plan = assertRecord(value, `result.ffmpegPlans[${index}]`);
    const sceneId = assertNonEmptyString(plan.sceneId, `result.ffmpegPlans[${index}].sceneId`);
    const command = plan.command;
    if (typeof command === 'string') {
      throw new TypeError(`result.ffmpegPlans[${index}].command must be an argv array, not a shell string`);
    }
    if (!Array.isArray(command)) {
      throw new TypeError(`result.ffmpegPlans[${index}].command must be an argv array`);
    }
    if (Object.hasOwn(plan, 'shell') || Object.hasOwn(plan, 'shellCommand') || Object.hasOwn(plan, 'commandLine')) {
      throw new TypeError(`result.ffmpegPlans[${index}] must not contain a shell command`);
    }
    const argv = command.map((argument, argumentIndex) => assertNonEmptyString(
      argument,
      `result.ffmpegPlans[${index}].command[${argumentIndex}]`,
    ));
    return {
      sceneId,
      renderPlan: assertRecord(plan.plan ?? plan.renderPlan, `result.ffmpegPlans[${index}].plan`),
      argv,
    };
  });

  return /** @type {RenderManifest} */ (JSON.parse(JSON.stringify({
    manifestVersion: 1,
    projectId,
    hardwareProfile,
    renderPlan,
    ffmpegPlans: manifestPlans,
    executionStatus: 'planned_only',
    status: 'planned_only',
  })));
}

/** @param {string} filePath @param {unknown} result @returns {Promise<RenderManifest>} */
export async function writeRenderManifest(filePath, result) {
  const path = assertNonEmptyString(filePath, 'render manifest path');
  const manifest = exportRenderManifest(result);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

export const createRenderManifest = exportRenderManifest;
export const buildRenderManifest = exportRenderManifest;

/** @param {unknown} value @param {string} path @returns {Record<string, unknown>} */
function assertRecord(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value @param {string} path @returns {string} */
function assertNonEmptyString(value, path) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  return value;
}

/** @param {unknown} value @param {string} path @param {Set<object>} [ancestors] */
function assertJsonValue(value, path, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must contain only finite JSON numbers`);
    return;
  }
  if (typeof value !== 'object') throw new TypeError(`${path} must contain only JSON-serializable data`);
  if (ancestors.has(value)) throw new TypeError(`${path} must not contain circular references`);
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, ancestors));
  } else {
    for (const [key, item] of Object.entries(value)) assertJsonValue(item, `${path}.${key}`, ancestors);
  }
  ancestors.delete(value);
}
