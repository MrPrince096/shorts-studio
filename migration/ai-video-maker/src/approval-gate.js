// @ts-check

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { cloneJson, createApproval } from './models.js';

export class ApprovalRequiredError extends Error {
  /** @param {string} projectId @param {string} stage */
  constructor(projectId, stage) {
    super(`Human approval is required before ${stage} generation for project ${projectId}`);
    this.name = 'ApprovalRequiredError';
    this.code = 'APPROVAL_REQUIRED';
    this.projectId = projectId;
    this.stage = stage;
  }
}

export class JsonApprovalGate {
  /** @param {string} filePath @param {{now?: () => string}} [options] */
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.now = options.now ?? (() => new Date().toISOString());
    /** @type {import('./models.js').Approval[]} */
    this.approvals = [];
    this.initialized = false;
  }

  async init() {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      this.approvals = JSON.parse(await readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
      await this.#flush();
    }
    this.initialized = true;
    return this;
  }

  #ensureInitialized() {
    if (!this.initialized) throw new Error('Approval gate must be initialized with await gate.init()');
  }

  async #flush() {
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.approvals, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.filePath);
  }

  /** @param {{projectId: string, stage: import('./models.js').StageName, sceneId?: string|null, requestedBy?: string}} input */
  async request(input) {
    this.#ensureInitialized();
    const existing = this.approvals.find((approval) => approval.projectId === input.projectId && approval.stage === input.stage && approval.sceneId === (input.sceneId ?? null) && approval.status === 'pending');
    if (existing) return cloneJson(existing);
    const approval = createApproval({
      id: `approval-${input.projectId}-${input.stage}-${input.sceneId ?? 'project'}`,
      projectId: input.projectId,
      stage: input.stage,
      sceneId: input.sceneId ?? null,
      requestedAt: this.now(),
    });
    this.approvals.push(approval);
    await this.#flush();
    return cloneJson(approval);
  }

  /** @param {string} approvalId @param {'approved'|'rejected'} status @param {{decidedBy?: string, note?: string}} [decision] */
  async decide(approvalId, status, decision = {}) {
    this.#ensureInitialized();
    const approval = this.approvals.find((candidate) => candidate.id === approvalId);
    if (!approval) throw new Error(`Approval not found: ${approvalId}`);
    approval.status = status;
    approval.decidedAt = this.now();
    approval.decidedBy = decision.decidedBy ?? null;
    approval.note = decision.note ?? null;
    await this.#flush();
    return cloneJson(approval);
  }

  /** @param {string} projectId @param {import('./models.js').StageName} stage */
  get(projectId, stage) {
    this.#ensureInitialized();
    const approval = this.approvals.find((candidate) => candidate.projectId === projectId && candidate.stage === stage && candidate.sceneId === null);
    return approval ? cloneJson(approval) : null;
  }

  /** @param {string} projectId @param {import('./models.js').StageName} stage */
  assertApproved(projectId, stage) {
    const approval = this.get(projectId, stage);
    if (!approval || approval.status !== 'approved') throw new ApprovalRequiredError(projectId, stage);
    return approval;
  }

  list() {
    this.#ensureInitialized();
    return cloneJson(this.approvals);
  }
}
