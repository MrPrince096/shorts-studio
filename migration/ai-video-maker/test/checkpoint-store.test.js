import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonCheckpointStore } from '../src/checkpoint-store.js';

test('checkpoint store persists stage and scene progress for resume', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-video-maker-test-'));
  const file = join(directory, 'checkpoints.json');
  const first = await new JsonCheckpointStore(file).init();
  await first.checkpointStage({ projectId: 'p1', stage: 'script', status: 'completed', artifactIds: ['a-script'] });
  await first.checkpointScene({ projectId: 'p1', stage: 'voice', sceneId: 's1', status: 'completed', artifactIds: ['a-voice'] });

  const resumed = await new JsonCheckpointStore(file).init();
  assert.equal(resumed.isStageComplete('p1', 'script'), true);
  assert.equal(resumed.isSceneComplete('p1', 'voice', 's1'), true);
  assert.deepEqual(resumed.getScene('p1', 'voice', 's1').artifactIds, ['a-voice']);
});
