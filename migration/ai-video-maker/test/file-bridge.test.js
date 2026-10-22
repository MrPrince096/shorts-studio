import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runScenesFile } from '../src/file-bridge.js';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'ai-video-maker-file-test-'));
  const scenesPath = join(directory, 'scenes.json');
  const checkpointPath = join(directory, 'checkpoint.json');
  const approvalPath = join(directory, 'approvals.json');
  await writeFile(scenesPath, JSON.stringify({
    id: 'file-project',
    title: 'Imported scenes',
    dimensions: { width: 1080, height: 1920 },
    scenes: { intro: { text: 'Hello from disk', query: 'bright studio', duration: 2 } },
  }), 'utf8');
  return { directory, scenesPath, checkpointPath, approvalPath };
}

test('imports a local scenes.json file and runs the cheap script stage', async () => {
  const paths = await fixture();
  const job = await runScenesFile(paths);

  assert.equal(job.project.id, 'file-project');
  assert.equal(job.project.scenes[0].narration, 'Hello from disk');
  assert.equal(job.summary.stages.script.status, 'completed');
  assert.equal(job.summary.status, 'awaiting_approval');
});

test('leaves downstream mock generation pending without explicit approval', async () => {
  const paths = await fixture();
  const job = await runScenesFile(paths);

  assert.equal(job.result, null);
  assert.equal(job.summary.approval.status, 'pending');
  assert.equal(job.summary.stages.voice.status, 'awaiting_approval');
  assert.deepEqual(job.summary.stages.voice.artifactIds, []);
  assert.equal(job.summary.checkpoint.scenes['file-project:voice:intro'], undefined);
});

test('resumes from the script checkpoint after the explicit approval flag', async () => {
  const paths = await fixture();
  await runScenesFile(paths);
  const job = await runScenesFile({ ...paths, approve: true });

  assert.equal(job.status, 'completed');
  assert.equal(job.summary.approval.status, 'approved');
  assert.equal(job.summary.currentStage, null);
  assert.equal(job.result.artifacts.length, 4);
  assert.equal(job.summary.stages.render.status, 'completed');
});

test('rejects malformed scenes JSON', async () => {
  const paths = await fixture();
  await writeFile(paths.scenesPath, '{"title":', 'utf8');

  await assert.rejects(
    () => runScenesFile(paths),
    /Unable to parse scenes JSON file/,
  );
});

test('status reporting is serializable and includes checkpoint state', async () => {
  const paths = await fixture();
  const job = await runScenesFile(paths);
  const serialized = JSON.parse(JSON.stringify(job.summary));

  assert.equal(serialized.projectId, 'file-project');
  assert.equal(serialized.checkpoint.version, 1);
  assert.equal(serialized.checkpoint.stages['file-project:script'].status, 'completed');
  assert.equal(serialized.paths.checkpoint, paths.checkpointPath);
});

test('accepts an explicit approval decision file', async () => {
  const paths = await fixture();
  const approvalFilePath = join(paths.directory, 'decision.json');
  await writeFile(approvalFilePath, JSON.stringify({ approved: true, decidedBy: 'file-reviewer' }), 'utf8');

  const job = await runScenesFile({ ...paths, approvalFilePath });

  assert.equal(job.status, 'completed');
  assert.equal(job.summary.approval.decidedBy, 'file-reviewer');
});
