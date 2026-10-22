import test from 'node:test';
import assert from 'node:assert/strict';
import { planRender } from '../src/render-planner.js';

test('uses VideoToolbox for M1 when the encoder is available', () => {
  const plan = planRender({
    platform: 'darwin',
    hardwareProfile: { id: 'm1-lite', modelDownloads: [] },
    availableEncoders: ['libx264', 'h264_videotoolbox'],
  });

  assert.deepEqual(plan, {
    codec: 'h264_videotoolbox',
    hardwareAcceleration: true,
    reason: 'Apple Silicon VideoToolbox is available and is the preferred hardware encoder.',
    requiresModelDownload: false,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan);
});

test('uses software fallback for M1 without VideoToolbox, even if NVENC is listed', () => {
  const plan = planRender({
    platform: 'darwin',
    hardwareProfile: 'm1-lite',
    availableEncoders: ['h264_nvenc', 'libx264'],
  });

  assert.equal(plan.codec, 'libx264');
  assert.equal(plan.hardwareAcceleration, false);
  assert.match(plan.reason, /VideoToolbox is unavailable/);
  assert.equal(plan.requiresModelDownload, false);
});

test('uses NVIDIA NVENC on a non-Apple platform when available', () => {
  const plan = planRender({
    platform: 'linux',
    hardwareProfile: { id: 'portable-cpu', modelDownloads: [] },
    availableEncoders: ['libx264', 'h264_nvenc'],
  });

  assert.deepEqual(plan, {
    codec: 'h264_nvenc',
    hardwareAcceleration: true,
    reason: 'NVIDIA NVENC is available on a non-Apple platform.',
    requiresModelDownload: false,
  });
});

test('uses software fallback when no eligible hardware encoder is available', () => {
  const plan = planRender({
    platform: 'win32',
    hardwareProfile: { id: 'portable-cpu', modelDownloads: [] },
    availableEncoders: ['mpeg4'],
  });

  assert.equal(plan.codec, 'libx264');
  assert.equal(plan.hardwareAcceleration, false);
  assert.match(plan.reason, /libx264 software encoder/);
  assert.equal(plan.requiresModelDownload, false);
});
