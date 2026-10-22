// @ts-check

import { readFile } from 'node:fs/promises';
import { ApprovalRequiredError } from './approval-gate.js';
import { JsonApprovalGate } from './approval-gate.js';
import { JsonCheckpointStore } from './checkpoint-store.js';
import { STAGE_DEFINITIONS } from './models.js';
import { VideoPipeline } from './pipeline.js';
import { adaptShortStudioScenesJson } from './short-studio-adapter.js';

/**
 * Read a Short Studio scenes file as JSON. The adapter remains data-only; this
 * function is the deliberately narrow file boundary around it.
 *
 * @param {string} filePath
 */
export async function loadScenesJson(filePath) {
  assertPath(filePath, 'scenes path');
  const contents = await readFile(filePath, 'utf8');
  try {
    return JSON.parse(contents);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SyntaxError(`Unable to parse scenes JSON file "${filePath}": ${message}`);
  }
}

/**
 * Import a scenes.json file, run the cheap script stage, and either pause for
 * approval or resume all mock generation stages. The returned value contains
 * only JSON-serializable project, result, and status data.
 *
 * @param {{scenesPath: string, checkpointPath?: string, approvalPath?: string, approvalFilePath?: string, approve?: boolean, decidedBy?: string, adapterOptions?: object, providers?: object, hardwareProfile?: object}} options
 */
export async function runScenesFile(options) {
  assertPath(options?.scenesPath, 'scenes path');
  const scenesPath = options.scenesPath;
  const checkpointPath = options.checkpointPath ?? `${scenesPath}.checkpoint.json`;
  const approvalPath = options.approvalPath ?? `${checkpointPath}.approvals.json`;
  assertPath(checkpointPath, 'checkpoint path');
  assertPath(approvalPath, 'approval path');

  const input = await loadScenesJson(scenesPath);
  const project = adaptShortStudioScenesJson(input, options.adapterOptions);
  const checkpointStore = await new JsonCheckpointStore(checkpointPath).init();
  const approvalGate = await new JsonApprovalGate(approvalPath).init();

  const approvalFileDecision = options.approvalFilePath
    ? await loadApprovalFile(options.approvalFilePath)
    : null;
  const shouldApprove = options.approve === true || approvalFileDecision?.approved === true;
  let approval = approvalGate.get(project.id, 'voice');
  if (shouldApprove || approvalFileDecision) {
    approval ??= await approvalGate.request({ projectId: project.id, stage: 'voice', requestedBy: 'file-bridge' });
    if (shouldApprove && approval.status !== 'approved') {
      approval = await approvalGate.decide(approval.id, 'approved', {
        decidedBy: options.decidedBy ?? approvalFileDecision?.decidedBy ?? 'explicit-approval',
        note: approvalFileDecision?.note ?? null,
      });
    }
  }

  const pipeline = new VideoPipeline({
    checkpointStore,
    approvalGate,
    providers: options.providers,
    hardwareProfile: options.hardwareProfile,
  });

  let result = null;
  try {
    result = await pipeline.runProject(project);
  } catch (error) {
    if (!(error instanceof ApprovalRequiredError)) throw error;
    approval = approvalGate.get(project.id, 'voice')
      ?? await approvalGate.request({ projectId: project.id, stage: 'voice', requestedBy: 'file-bridge' });
  }

  const summary = getJobStatusSummary({
    project,
    checkpointStore,
    approvalGate,
    scenesPath,
    checkpointPath,
    approvalPath,
  });
  return { project, result, status: summary.status, summary };
}

/**
 * Build a JSON-safe job and checkpoint summary from initialized stores.
 *
 * @param {{project: import('./models.js').Project, checkpointStore: JsonCheckpointStore, approvalGate: JsonApprovalGate, scenesPath?: string, checkpointPath?: string, approvalPath?: string}} input
 */
export function getJobStatusSummary(input) {
  const { project, checkpointStore, approvalGate } = input;
  const checkpoint = checkpointStore.snapshot();
  const approval = approvalGate.get(project.id, 'voice');
  const stages = Object.fromEntries(STAGE_DEFINITIONS.map((definition) => {
    const saved = checkpoint.stages[checkpointStore.stageKey(project.id, definition.id)] ?? null;
    return [definition.id, {
      id: definition.id,
      label: definition.label,
      requiresApproval: definition.requiresApproval,
      status: saved?.status ?? (definition.id === 'voice' && approval?.status === 'pending' ? 'awaiting_approval' : 'queued'),
      artifactIds: saved?.artifactIds ?? [],
      error: saved?.error ?? null,
      updatedAt: saved?.updatedAt ?? null,
    }];
  }));
  const completed = STAGE_DEFINITIONS.every((definition) => stages[definition.id].status === 'completed');
  const status = completed
    ? 'completed'
    : approval?.status === 'pending' && stages.script.status === 'completed'
      ? 'awaiting_approval'
      : Object.values(stages).some((stage) => stage.status === 'failed')
        ? 'failed'
        : 'queued';
  const currentStage = completed
    ? null
    : STAGE_DEFINITIONS.find((definition) => stages[definition.id].status !== 'completed')?.id ?? null;

  return {
    jobId: `job-${project.id}`,
    projectId: project.id,
    projectTitle: project.title,
    status,
    currentStage,
    sceneCount: project.scenes.length,
    approval,
    paths: {
      scenes: input.scenesPath ?? null,
      checkpoint: input.checkpointPath ?? null,
      approval: input.approvalPath ?? null,
    },
    stages,
    checkpoint: {
      version: checkpoint.version,
      stages: checkpoint.stages,
      scenes: checkpoint.scenes,
    },
  };
}

/** @param {string} filePath */
async function loadApprovalFile(filePath) {
  assertPath(filePath, 'approval file path');
  const contents = await readFile(filePath, 'utf8');
  try {
    const value = JSON.parse(contents);
    if (typeof value === 'boolean') return { approved: value };
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('approval file must contain an object or boolean');
    }
    return {
      approved: value.approved === true || value.status === 'approved',
      decidedBy: typeof value.decidedBy === 'string' ? value.decidedBy : undefined,
      note: typeof value.note === 'string' ? value.note : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof SyntaxError) {
      throw new SyntaxError(`Unable to parse approval JSON file "${filePath}": ${message}`);
    }
    throw error;
  }
}

/** @param {unknown} value @param {string} label */
function assertPath(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`);
}
