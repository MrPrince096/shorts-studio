import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditFfmpegCapabilities,
  buildCapabilityReport,
  compareRenderManifestEncoders,
  parseFfmpegEncoderOutput,
} from '../src/capability-audit.js';

test('parses and normalizes FFmpeg encoder rows without parsing headings', () => {
  const output = [
    'Encoders:',
    ' V..... = Video',
    ' A..... = Audio',
    ' V..... h264_videotoolbox Apple VideoToolbox H.264 Encoder',
    ' V....D h264_nvenc NVIDIA NVENC H.264 encoder',
    ' V..... libx264 libx264 H.264 / AVC / MPEG-4 AVC',
    ' V..... H264_VIDEOTOOLBOX duplicate with different case',
  ].join('\n');

  assert.deepEqual(parseFfmpegEncoderOutput(output), [
    'h264_videotoolbox',
    'h264_nvenc',
    'libx264',
  ]);
});

test('builds an Apple Silicon capability plan with VideoToolbox', () => {
  const report = buildCapabilityReport({
    platform: 'darwin',
    hardwareProfile: 'm1-lite',
    availableEncoders: ['libx264', 'h264_videotoolbox'],
  });

  assert.equal(report.hardwareProfile.id, 'm1-lite');
  assert.equal(report.renderPlan.codec, 'h264_videotoolbox');
  assert.equal(report.renderPlan.hardwareAcceleration, true);
  assert.equal(report.renderPlan.requiresModelDownload, false);
});

test('reports unavailable FFmpeg safely and falls back to libx264', async () => {
  const report = await auditFfmpegCapabilities({
    ffmpegPath: '/path/that/does/not/exist/ffmpeg',
    platform: 'darwin',
    hardwareProfile: 'm1-lite',
  });

  assert.equal(report.executionStatus, 'planned_only');
  assert.equal(report.ffmpeg.available, false);
  assert.deepEqual(report.detectedEncoders, []);
  assert.equal(report.renderPlan.codec, 'libx264');
  assert.equal(report.hardwareProfile.modelDownloads.length, 0);
});

test('finds planned codec mismatches in a planned-only manifest', () => {
  const comparison = compareRenderManifestEncoders({
    executionStatus: 'planned_only',
    status: 'planned_only',
    renderPlan: { codec: 'h264_videotoolbox' },
    ffmpegPlans: [{ sceneId: 'scene-1', renderPlan: { codec: 'h264_videotoolbox' } }],
  }, ['libx264']);

  assert.equal(comparison.compatible, false);
  assert.equal(comparison.matches, false);
  assert.deepEqual(comparison.missingEncoders, ['h264_videotoolbox']);
  assert.deepEqual(comparison.checks, [
    { codec: 'h264_videotoolbox', available: false },
    { codec: 'h264_videotoolbox', available: false, sceneId: 'scene-1' },
  ]);
});
