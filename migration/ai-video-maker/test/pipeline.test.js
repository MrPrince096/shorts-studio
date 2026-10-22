import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProject, createScene } from '../src/models.js';
import { JsonCheckpointStore } from '../src/checkpoint-store.js';
import { ApprovalRequiredError, JsonApprovalGate } from '../src/approval-gate.js';
import { selectHardwareProfile } from '../src/hardware.js';
import { createMockProviders } from '../src/providers.js';
import { VideoPipeline } from '../src/pipeline.js';

test('pipeline pauses after script, then completes deterministically after approval and resumes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-video-maker-test-'));
  const project = createProject({
    id: 'p1',
    title: 'Pipeline test',
    scenes: [
      createScene({ id: 's1', order: 1, title: 'One', narration: 'First scene', visualPrompt: 'First visual' }),
      createScene({ id: 's2', order: 2, title: 'Two', narration: 'Second scene', visualPrompt: 'Second visual' }),
    ],
  });
  const checkpoints = await new JsonCheckpointStore(join(directory, 'checkpoints.json')).init();
  const approvals = await new JsonApprovalGate(join(directory, 'approvals.json')).init();
  const providers = createMockProviders();
  let expensiveCalls = 0;
  for (const provider of [providers.voice, providers.captions, providers.visuals, providers.render]) {
    for (const method of Object.keys(provider)) {
      const original = provider[method];
      provider[method] = async (...args) => {
        expensiveCalls += 1;
        return original(...args);
      };
    }
  }
  const pipeline = new VideoPipeline({ checkpointStore: checkpoints, approvalGate: approvals, providers, hardwareProfile: selectHardwareProfile('m1-lite') });

  await assert.rejects(() => pipeline.runProject(project), ApprovalRequiredError);
  assert.equal(checkpoints.isStageComplete(project.id, 'script'), true);
  assert.equal(expensiveCalls, 0);

  const approval = await approvals.request({ projectId: project.id, stage: 'voice' });
  await approvals.decide(approval.id, 'approved', { decidedBy: 'reviewer' });
  const result = await pipeline.runProject(project);
  assert.equal(result.status, 'completed');
  assert.equal(result.hardwareProfile.id, 'm1-lite');
  assert.deepEqual(result.hardwareProfile.modelDownloads, []);
  assert.equal(result.artifacts.length, project.scenes.length * 4);
  assert.equal(result.renderPlan.codec, 'h264_videotoolbox');
  assert.equal(result.ffmpegPlans.length, project.scenes.length);
  assert.equal(result.ffmpegPlans[0].plan.codec, 'h264_videotoolbox');
  assert.ok(Array.isArray(result.ffmpegPlans[0].command));
  assert.equal(result.ffmpegPlans[0].command[0], 'ffmpeg');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert.deepEqual(checkpoints.getStage(project.id, 'script').artifactIds, ['artifact-p1-script-project']);

  const callsAfterCompletion = expensiveCalls;
  const resumedResult = await pipeline.runProject(project);
  assert.equal(expensiveCalls, callsAfterCompletion);
  assert.equal(resumedResult.status, 'completed');
});
