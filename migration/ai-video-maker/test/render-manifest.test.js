import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { exportRenderManifest, writeRenderManifest } from '../src/render-manifest.js';

const completedResult = {
  projectId: 'manifest-project',
  hardwareProfile: {
    id: 'm1-lite',
    execution: 'mock-only',
    modelDownloads: [],
  },
  renderPlan: {
    codec: 'h264_videotoolbox',
    hardwareAcceleration: true,
    reason: 'test plan',
    requiresModelDownload: false,
  },
  ffmpegPlans: [{
    sceneId: 'scene-1',
    plan: { codec: 'h264_videotoolbox' },
    command: ['ffmpeg', '-i', 'mock://visual/scene-1.png', 'mock://render/scene-1.mp4'],
  }],
  status: 'completed',
};

test('exports and writes a reviewable planned-only render manifest', async () => {
  const manifest = exportRenderManifest(completedResult);

  assert.equal(manifest.projectId, 'manifest-project');
  assert.equal(manifest.hardwareProfile.execution, 'mock-only');
  assert.equal(manifest.renderPlan.codec, 'h264_videotoolbox');
  assert.deepEqual(manifest.ffmpegPlans[0].argv, completedResult.ffmpegPlans[0].command);
  assert.equal(manifest.executionStatus, 'planned_only');
  assert.equal(manifest.status, 'planned_only');
  assert.deepEqual(JSON.parse(JSON.stringify(manifest)), manifest);

  const directory = await mkdtemp(join(tmpdir(), 'ai-video-maker-manifest-test-'));
  const manifestPath = join(directory, 'review', 'render-manifest.json');
  await writeRenderManifest(manifestPath, completedResult);
  const written = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.deepEqual(written, manifest);
});

test('rejects incomplete, non-JSON, and shell-string render results', () => {
  assert.throws(() => exportRenderManifest({ ...completedResult, status: 'running' }), /completed pipeline result/);
  assert.throws(() => exportRenderManifest({
    ...completedResult,
    ffmpegPlans: [{ ...completedResult.ffmpegPlans[0], command: 'ffmpeg -i input output' }],
  }), /argv array, not a shell string/);
  assert.throws(() => exportRenderManifest({
    ...completedResult,
    ffmpegPlans: [{ ...completedResult.ffmpegPlans[0], command: ['ffmpeg', undefined] }],
  }), /JSON-serializable/);
});
