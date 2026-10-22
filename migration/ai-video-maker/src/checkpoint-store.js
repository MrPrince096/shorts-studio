// @ts-check

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { cloneJson, assertStage } from './models.js';

/**
 * JSON-backed checkpoints make a pipeline restartable without introducing a database.
 * The file is replaced atomically after every checkpoint update.
 */
export class JsonCheckpointStore {
  /** @param {string} filePath */
  constructor(filePath) {
    this.filePath = filePath;
    /** @type {{version: 1, stages: Record<string, any>, scenes: Record<string, any>}} */
    this.state = { version: 1, stages: {}, scenes: {} };
    this.initialized = false;
  }

  async init() {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      this.state = JSON.parse(await readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
      await this.#flush();
    }
    this.initialized = true;
    return this;
  }

  #ensureInitialized() {
    if (!this.initialized) throw new Error('Checkpoint store must be initialized with await store.init()');
  }

  async #flush() {
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.filePath);
  }

  /** @param {string} projectId @param {string} stage */
  stageKey(projectId, stage) {
    assertStage(stage);
    return `${projectId}:${stage}`;
  }

  /** @param {string} projectId @param {string} stage @param {string} sceneId */
  sceneKey(projectId, stage, sceneId) {
    assertStage(stage);
    return `${projectId}:${stage}:${sceneId}`;
  }

  /**
   * @param {{projectId: string, stage: string, status: string, artifactIds?: string[], error?: string|null}} checkpoint
   */
  async checkpointStage(checkpoint) {
    this.#ensureInitialized();
    const key = this.stageKey(checkpoint.projectId, checkpoint.stage);
    this.state.stages[key] = {
      projectId: checkpoint.projectId,
      stage: checkpoint.stage,
      status: checkpoint.status,
      artifactIds: checkpoint.artifactIds ?? [],
      error: checkpoint.error ?? null,
      updatedAt: new Date().toISOString(),
    };
    await this.#flush();
    return cloneJson(this.state.stages[key]);
  }

  /**
   * @param {{projectId: string, stage: string, sceneId: string, status: string, artifactIds?: string[], error?: string|null}} checkpoint
   */
  async checkpointScene(checkpoint) {
    this.#ensureInitialized();
    const key = this.sceneKey(checkpoint.projectId, checkpoint.stage, checkpoint.sceneId);
    this.state.scenes[key] = {
      projectId: checkpoint.projectId,
      stage: checkpoint.stage,
      sceneId: checkpoint.sceneId,
      status: checkpoint.status,
      artifactIds: checkpoint.artifactIds ?? [],
      error: checkpoint.error ?? null,
      updatedAt: new Date().toISOString(),
    };
    await this.#flush();
    return cloneJson(this.state.scenes[key]);
  }

  /** @param {string} projectId @param {string} stage */
  getStage(projectId, stage) {
    this.#ensureInitialized();
    return cloneJson(this.state.stages[this.stageKey(projectId, stage)] ?? null);
  }

  /** @param {string} projectId @param {string} stage @param {string} sceneId */
  getScene(projectId, stage, sceneId) {
    this.#ensureInitialized();
    return cloneJson(this.state.scenes[this.sceneKey(projectId, stage, sceneId)] ?? null);
  }

  /** @param {string} projectId @param {string} stage */
  isStageComplete(projectId, stage) {
    return this.getStage(projectId, stage)?.status === 'completed';
  }

  /** @param {string} projectId @param {string} stage @param {string} sceneId */
  isSceneComplete(projectId, stage, sceneId) {
    return this.getScene(projectId, stage, sceneId)?.status === 'completed';
  }

  snapshot() {
    this.#ensureInitialized();
    return cloneJson(this.state);
  }
}
