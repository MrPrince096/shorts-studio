import test from 'node:test';
import assert from 'node:assert/strict';
import { planFfmpegCommand } from '../src/ffmpeg-planner.js';
import { planRender } from '../src/render-planner.js';

const dimensions = { width: 1080, height: 1920 };

test('plans VideoToolbox argv for an M1 render without executing FFmpeg', () => {
  const renderPlan = planRender({
    platform: 'darwin',
    hardwareProfile: 'm1-lite',
    availableEncoders: ['libx264', 'h264_videotoolbox'],
  });
  const command = planFfmpegCommand({
    renderPlan,
    dimensions,
    fps: 30,
    inputArtifacts: ['mock://visual/scene-1.png'],
    audioInputs: ['mock://voice/scene-1.wav'],
    captionInputs: ['mock://captions/scene-1.json'],
    outputPath: 'mock://render/project/scene-1.mp4',
  });

  assert.equal(command.argv[0], 'ffmpeg');
  assert.ok(command.argv.includes('h264_videotoolbox'));
  assert.ok(command.argv.includes('-allow_sw'));
  assert.ok(command.argv.includes('-c:a'));
  assert.deepEqual(JSON.parse(JSON.stringify(command)), command);
});

test('plans libx264 software fallback flags', () => {
  const command = planFfmpegCommand({
    renderPlan: planRender({ platform: 'darwin', hardwareProfile: 'm1-lite', availableEncoders: ['libx264'] }),
    dimensions,
    fps: 24,
    inputArtifacts: ['/tmp/input.mov'],
    outputPath: '/tmp/output.mp4',
  });

  assert.equal(command.renderPlan.codec, 'libx264');
  assert.ok(command.argv.includes('-crf'));
  assert.ok(command.argv.includes('23'));
  assert.ok(!command.argv.includes('-allow_sw'));
});

test('plans NVENC-specific rate-control flags', () => {
  const command = planFfmpegCommand({
    renderPlan: planRender({ platform: 'linux', hardwareProfile: 'portable-cpu', availableEncoders: ['h264_nvenc'] }),
    dimensions,
    fps: 60,
    inputArtifacts: [{ path: '/tmp/input.mov' }],
    outputPath: '/tmp/output.mp4',
  });

  assert.equal(command.renderPlan.codec, 'h264_nvenc');
  assert.ok(command.argv.includes('-preset'));
  assert.ok(command.argv.includes('p4'));
  assert.ok(command.argv.includes('-rc'));
  assert.ok(command.argv.includes('vbr'));
});

test('rejects empty and unsafe paths before producing argv', () => {
  const base = {
    renderPlan: planRender({ platform: 'darwin', hardwareProfile: 'm1-lite', availableEncoders: ['libx264'] }),
    dimensions,
    fps: 30,
    inputArtifacts: ['/tmp/input.mov'],
    outputPath: '/tmp/output.mp4',
  };

  assert.throws(() => planFfmpegCommand({ ...base, outputPath: '/tmp/out;rm -rf /' }), /unsafe characters/);
  assert.throws(() => planFfmpegCommand({ ...base, inputArtifacts: [] }), /must contain at least one item/);
  assert.throws(() => planFfmpegCommand({ ...base, audioInputs: [''] }), /must be a non-empty string/);
});
