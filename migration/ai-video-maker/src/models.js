// @ts-check

/** @typedef {'script'|'voice'|'captions'|'visuals'|'render'} StageName */
/** @typedef {'queued'|'running'|'awaiting_approval'|'completed'|'failed'} JobStatus */
/** @typedef {'pending'|'approved'|'rejected'} ApprovalStatus */

/**
 * @typedef {Object} StageDefinition
 * @property {StageName} id
 * @property {string} label
 * @property {boolean} requiresApproval
 * @property {boolean} sceneScoped
 */

/**
 * @typedef {Object} ProjectSettings
 * @property {string} aspectRatio
 * @property {number} frameRate
 * @property {string} language
 * @property {number} [width]
 * @property {number} [height]
 * @property {string} [voice]
 */

/**
 * @typedef {Object} Scene
 * @property {string} id
 * @property {number} order
 * @property {string} title
 * @property {string} narration
 * @property {string} visualPrompt
 * @property {number} durationMs
 */

/**
 * @typedef {Object} Asset
 * @property {string} id
 * @property {'image'|'video'|'audio'|'font'|'data'} kind
 * @property {string} uri
 * @property {string} source
 * @property {Record<string, string|number|boolean>} metadata
 */

/**
 * @typedef {Object} TimelineClip
 * @property {string} id
 * @property {string} sceneId
 * @property {string} assetId
 * @property {'video'|'audio'|'caption'} track
 * @property {number} startMs
 * @property {number} durationMs
 */

/**
 * @typedef {Object} Project
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {ProjectSettings} settings
 * @property {Scene[]} scenes
 * @property {Asset[]} assets
 * @property {TimelineClip[]} timeline
 */

/**
 * @typedef {Object} GenerationJob
 * @property {string} id
 * @property {string} projectId
 * @property {StageName} stage
 * @property {JobStatus} status
 * @property {string[]} sceneIds
 * @property {number} attempts
 * @property {string[]} outputArtifactIds
 * @property {string|null} error
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} Approval
 * @property {string} id
 * @property {string} projectId
 * @property {StageName} stage
 * @property {string|null} sceneId
 * @property {ApprovalStatus} status
 * @property {string} requestedAt
 * @property {string|null} decidedAt
 * @property {string|null} decidedBy
 * @property {string|null} note
 */

/**
 * @typedef {Object} Artifact
 * @property {string} id
 * @property {string} projectId
 * @property {StageName} stage
 * @property {string|null} sceneId
 * @property {'script'|'audio'|'captions'|'visual'|'video'} kind
 * @property {string} uri
 * @property {string} checksum
 * @property {Record<string, unknown>} metadata
 */

/** @type {readonly StageName[]} */
export const STAGES = Object.freeze(['script', 'voice', 'captions', 'visuals', 'render']);

/** @type {readonly StageDefinition[]} */
export const STAGE_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'script', label: 'Script', requiresApproval: false, sceneScoped: false }),
  Object.freeze({ id: 'voice', label: 'Voice', requiresApproval: true, sceneScoped: true }),
  Object.freeze({ id: 'captions', label: 'Captions', requiresApproval: true, sceneScoped: true }),
  Object.freeze({ id: 'visuals', label: 'Visuals', requiresApproval: true, sceneScoped: true }),
  Object.freeze({ id: 'render', label: 'Render', requiresApproval: true, sceneScoped: true }),
]);

/** @param {string} value */
export function assertStage(value) {
  if (!STAGES.includes(/** @type {StageName} */ (value))) {
    throw new Error(`Unknown stage: ${value}`);
  }
}

/** @param {unknown} value */
export function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

/** @param {Partial<Project> & Pick<Project, 'id'|'title'>} input */
export function createProject(input) {
  const now = input.updatedAt ?? input.createdAt ?? new Date(0).toISOString();
  return {
    id: input.id,
    title: input.title,
    description: input.description ?? '',
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    settings: input.settings ?? { aspectRatio: '9:16', frameRate: 30, language: 'en-US' },
    scenes: input.scenes ?? [],
    assets: input.assets ?? [],
    timeline: input.timeline ?? [],
  };
}

/** @param {Partial<Scene> & Pick<Scene, 'id'|'order'|'title'>} input */
export function createScene(input) {
  return {
    id: input.id,
    order: input.order,
    title: input.title,
    narration: input.narration ?? '',
    visualPrompt: input.visualPrompt ?? '',
    durationMs: input.durationMs ?? 5000,
  };
}

/** @param {Partial<Asset> & Pick<Asset, 'id'|'kind'|'uri'|'source'>} input */
export function createAsset(input) {
  return {
    id: input.id,
    kind: input.kind,
    uri: input.uri,
    source: input.source,
    metadata: input.metadata ?? {},
  };
}

/** @param {Partial<TimelineClip> & Pick<TimelineClip, 'id'|'sceneId'|'assetId'|'track'>} input */
export function createTimelineClip(input) {
  return {
    id: input.id,
    sceneId: input.sceneId,
    assetId: input.assetId,
    track: input.track,
    startMs: input.startMs ?? 0,
    durationMs: input.durationMs ?? 0,
  };
}

/** @param {Partial<GenerationJob> & Pick<GenerationJob, 'id'|'projectId'|'stage'>} input */
export function createGenerationJob(input) {
  const now = input.updatedAt ?? input.createdAt ?? new Date(0).toISOString();
  return {
    id: input.id,
    projectId: input.projectId,
    stage: input.stage,
    status: input.status ?? 'queued',
    sceneIds: input.sceneIds ?? [],
    attempts: input.attempts ?? 0,
    outputArtifactIds: input.outputArtifactIds ?? [],
    error: input.error ?? null,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

/** @param {Partial<Approval> & Pick<Approval, 'id'|'projectId'|'stage'>} input */
export function createApproval(input) {
  return {
    id: input.id,
    projectId: input.projectId,
    stage: input.stage,
    sceneId: input.sceneId ?? null,
    status: input.status ?? 'pending',
    requestedAt: input.requestedAt ?? new Date(0).toISOString(),
    decidedAt: input.decidedAt ?? null,
    decidedBy: input.decidedBy ?? null,
    note: input.note ?? null,
  };
}

/** @param {Partial<Artifact> & Pick<Artifact, 'id'|'projectId'|'stage'|'kind'|'uri'|'checksum'>} input */
export function createArtifact(input) {
  return {
    id: input.id,
    projectId: input.projectId,
    stage: input.stage,
    sceneId: input.sceneId ?? null,
    kind: input.kind,
    uri: input.uri,
    checksum: input.checksum,
    metadata: input.metadata ?? {},
  };
}
