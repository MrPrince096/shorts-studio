// @ts-check

import { createAsset, createProject, createScene, createTimelineClip } from './models.js';

/**
 * @typedef {Object} AdapterOptions
 * @property {string} [projectId]
 * @property {number} [frameRate]
 * @property {string} [language]
 */

/**
 * Convert a Short Studio-like in-memory scenes.json mapping into the scaffold
 * project contract. This adapter intentionally accepts data only: it does not
 * read a file, resolve a URI, or call a provider or network service.
 *
 * Supported input shape:
 * {
 *   title: string,
 *   dimensions: { width: number, height: number } | [number, number] | "1080x1920",
 *   voice?: string | { id?: string, name?: string, voiceId?: string },
 *   scenes: { [sceneId: string]: {
 *     title?: string,
 *     text?: string,
 *     query?: string,
 *     start?: number,
 *     duration?: number,
 *     startTime?: number,
 *     endTime?: number,
 *     startMs?: number,
 *     durationMs?: number
 *   } }
 * }
 *
 * `start` and `duration` are source seconds; explicit `startMs` and
 * `durationMs` values are already milliseconds. The original source values
 * are retained in visual asset metadata as `sourceStart` and
 * `sourceDuration` when present.
 *
 * @param {unknown} input
 * @param {AdapterOptions} [options]
 */
export function adaptShortStudioScenesJson(input, options = {}) {
  if (!isRecord(input)) {
    throw new TypeError('Short Studio scenes.json must be an object');
  }

  const title = requiredString(input.title, 'title');
  const dimensions = normalizeDimensions(input.dimensions ?? input);
  const sceneEntries = normalizeSceneEntries(input.scenes);
  if (sceneEntries.length === 0) {
    throw new RangeError('Short Studio scenes.json must contain at least one scene');
  }

  const projectId = requiredString(
    options.projectId ?? input.id ?? `project-${slugify(title)}`,
    'project id',
  );
  const frameRate = options.frameRate ?? input.frameRate ?? 30;
  assertPositiveFinite(frameRate, 'frameRate');
  const language = options.language ?? input.language ?? 'en-US';
  const voice = normalizeVoice(input.voice ?? input.voiceId);
  const voiceAssetId = `${projectId}-voice`;

  const scenes = [];
  const assets = [createAsset({
    id: voiceAssetId,
    kind: 'audio',
    uri: `short-studio://project/${encodeURIComponent(projectId)}/voice`,
    source: 'short-studio-scenes-json',
    metadata: {
      role: 'voice',
      voice,
      width: dimensions.width,
      height: dimensions.height,
    },
  })];
  const timeline = [];

  sceneEntries.forEach(([sourceId, sourceScene], index) => {
    const sceneId = requiredString(sourceScene.id ?? sourceId, `scene ${index + 1} id`);
    const order = sourceScene.order ?? index + 1;
    assertNonNegativeFinite(order, `scene ${sceneId} order`);

    const timing = normalizeTiming(sourceScene, sceneId);
    const scene = createScene({
      id: sceneId,
      order,
      title: sourceScene.title ?? `Scene ${index + 1}`,
      narration: sourceScene.text ?? sourceScene.narration ?? '',
      visualPrompt: sourceScene.query ?? sourceScene.visualPrompt ?? '',
      durationMs: timing.durationMs,
    });
    scenes.push(scene);

    const visualAssetId = `${projectId}-${sceneId}-visual`;
    assets.push(createAsset({
      id: visualAssetId,
      kind: 'image',
      uri: `short-studio://project/${encodeURIComponent(projectId)}/scene/${encodeURIComponent(sceneId)}/visual`,
      source: 'short-studio-scenes-json',
      metadata: {
        role: 'scene-visual',
        sourceSceneId: sceneId,
        query: scene.visualPrompt,
        width: dimensions.width,
        height: dimensions.height,
        startMs: timing.startMs,
        durationMs: timing.durationMs,
        ...(timing.sourceStart === undefined ? {} : { sourceStart: timing.sourceStart }),
        ...(timing.sourceDuration === undefined ? {} : { sourceDuration: timing.sourceDuration }),
      },
    }));

    timeline.push(createTimelineClip({
      id: `${projectId}-${sceneId}-visual-clip`,
      sceneId,
      assetId: visualAssetId,
      track: 'video',
      startMs: timing.startMs,
      durationMs: timing.durationMs,
    }));
    timeline.push(createTimelineClip({
      id: `${projectId}-${sceneId}-voice-clip`,
      sceneId,
      assetId: voiceAssetId,
      track: 'audio',
      startMs: timing.startMs,
      durationMs: timing.durationMs,
    }));
  });

  return createProject({
    id: projectId,
    title,
    settings: {
      aspectRatio: `${dimensions.width}:${dimensions.height}`,
      frameRate,
      language,
      width: dimensions.width,
      height: dimensions.height,
      voice,
    },
    scenes,
    assets,
    timeline,
  });
}

/** Alias with a shorter name for callers that already have a scenes.json value. */
export const adaptScenesJson = adaptShortStudioScenesJson;

/** Descriptive alias for callers converting a Short Studio project boundary. */
export const convertShortStudioScenes = adaptShortStudioScenesJson;

/** @param {unknown} value */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value @param {string} label */
function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

/** @param {unknown} value @param {string} label */
function assertPositiveFinite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number`);
  }
}

/** @param {unknown} value @param {string} label */
function assertNonNegativeFinite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite number`);
  }
}

/** @param {unknown} value */
function normalizeDimensions(value) {
  let width;
  let height;
  if (Array.isArray(value)) {
    [width, height] = value;
  } else if (typeof value === 'string') {
    const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*[x×:]\s*(\d+(?:\.\d+)?)$/i);
    if (match) {
      width = Number(match[1]);
      height = Number(match[2]);
    }
  } else if (isRecord(value)) {
    width = value.width;
    height = value.height;
  }

  if (typeof width !== 'number' || typeof height !== 'number' ||
      !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError('dimensions must contain positive integer width and height');
  }
  return { width, height };
}

/** @param {unknown} scenes */
function normalizeSceneEntries(scenes) {
  if (Array.isArray(scenes)) {
    return scenes.map((scene, index) => {
      if (!isRecord(scene)) {
        throw new TypeError(`scene ${index + 1} must be an object`);
      }
      return [String(scene.id ?? index + 1), scene];
    });
  }
  if (!isRecord(scenes)) {
    throw new TypeError('scenes must be a mapping or array');
  }
  return Object.entries(scenes).map(([id, scene]) => {
    if (!isRecord(scene)) {
      throw new TypeError(`scene ${id} must be an object`);
    }
    return [id, scene];
  });
}

/** @param {Record<string, unknown>} scene @param {string} sceneId */
function normalizeTiming(scene, sceneId) {
  const startField = firstDefinedField(scene, ['startMs', 'start', 'startTime']);
  const durationField = firstDefinedField(scene, ['durationMs', 'duration', 'durationSeconds']);
  const endField = firstDefinedField(scene, ['endMs', 'end', 'endTime']);

  const start = startField ? scene[startField] : 0;
  const startMs = startField === 'startMs' ? start : toMilliseconds(start, `${sceneId} start`);
  let duration;
  if (durationField) {
    duration = durationField === 'durationMs'
      ? scene[durationField]
      : toMilliseconds(scene[durationField], `${sceneId} duration`);
  } else if (endField) {
    const endMs = endField === 'endMs' ? scene[endField] : toMilliseconds(scene[endField], `${sceneId} end`);
    duration = endMs - startMs;
  } else {
    duration = 5000;
  }

  assertNonNegativeFinite(startMs, `${sceneId} startMs`);
  assertNonNegativeFinite(duration, `${sceneId} durationMs`);
  return {
    startMs,
    durationMs: duration,
    sourceStart: startField ? scene[startField] : undefined,
    sourceDuration: durationField ? scene[durationField] : undefined,
  };
}

/** @param {Record<string, unknown>} value @param {string[]} fields */
function firstDefinedField(value, fields) {
  return fields.find((field) => value[field] !== undefined);
}

/** @param {unknown} value @param {string} label */
function toMilliseconds(value, label) {
  assertNonNegativeFinite(value, label);
  return value * 1000;
}

/** @param {unknown} value */
function normalizeVoice(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (isRecord(value)) {
    const candidate = value.id ?? value.voiceId ?? value.name ?? value.voice;
    return candidate === undefined ? '' : requiredString(candidate, 'voice');
  }
  throw new TypeError('voice must be a string or voice descriptor object');
}

/** @param {string} title */
function slugify(title) {
  return title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
}
