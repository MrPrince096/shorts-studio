import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeFfmpeg, executeRenderManifest, validateFfmpegExecution, validateRenderManifest } from '../src/ffmpeg-executor.js';

const approval = { approved: true, executionMode: 'local-ffmpeg' };
const base = {
  argv: ['/usr/bin/ffmpeg', '-i', '/tmp/input.mov', '/tmp/output.mp4'],
  approval,
  hardwareProfile: { id: 'local', execution: 'local', modelDownloads: [] },
};

test('refuses execution without explicit approval', () => {
  assert.throws(() => validateFfmpegExecution({ ...base, approval: undefined }), /approved:true/);
  assert.throws(() => validateFfmpegExecution({ ...base, approval: { approved: true } }), /executionMode/);
});

test('refuses remote and non-local URI inputs', () => {
  assert.throws(() => validateFfmpegExecution({ ...base, argv: ['/usr/bin/ffmpeg', '-i', 'https://example.test/input.mov', '/tmp/output.mp4'] }), /non-local URI/);
  assert.throws(() => validateFfmpegExecution({ ...base, argv: ['/usr/bin/ffmpeg', '-i', 's3://bucket/input.mov', '/tmp/output.mp4'] }), /non-local URI/);
  assert.throws(() => validateFfmpegExecution({ ...base, argv: ['/usr/bin/ffmpeg', '-i', '/tmp/input;rm.mov', '/tmp/output.mp4'] }), /unsafe characters/);
  assert.throws(() => validateFfmpegExecution({ ...base, argv: ['/usr/bin/ffmpeg', '-i', '../input.mov', '/tmp/output.mp4'] }), /path traversal/);
});

test('invokes a fake executable with argv and no shell interpolation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-video-maker-executor-test-'));
  const scriptPath = join(directory, 'fake-ffmpeg.js');
  await writeFile(scriptPath, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n", 'utf8');
  await chmod(scriptPath, 0o755);

  const receipt = await executeFfmpeg({
    ...base,
    argv: [process.execPath, scriptPath, '-i', join(directory, 'input.mov'), join(directory, 'output.mp4')],
  });

  assert.equal(receipt.ok, true);
  assert.equal(receipt.exitCode, 0);
  assert.deepEqual(JSON.parse(receipt.stdout), ['-i', join(directory, 'input.mov'), join(directory, 'output.mp4')]);
  assert.equal(receipt.stderr, '');
  assert.deepEqual(JSON.parse(JSON.stringify(receipt)), receipt);
});

test('validates and executes a manifest with local media input and output files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-video-maker-local-manifest-test-'));
  const inputPath = join(directory, 'input.fake-media');
  const outputPath = join(directory, 'output.fake-media');
  const scriptPath = join(directory, 'fake-ffmpeg.js');
  await writeFile(inputPath, 'deterministic-media-input\n', 'utf8');
  await writeFile(scriptPath, [
    "import { readFileSync, writeFileSync } from 'node:fs';",
    "const argv = process.argv.slice(2);",
    "const input = argv[argv.indexOf('-i') + 1];",
    "const output = argv.at(-1);",
    "writeFileSync(output, `fake-render:${readFileSync(input, 'utf8')}`);",
    "process.stdout.write('local-fake-ffmpeg-ok');",
  ].join('\n'), 'utf8');
  await chmod(scriptPath, 0o755);

  const manifest = {
    manifestVersion: 1,
    projectId: 'local-manifest-project',
    hardwareProfile: { id: 'local-test', execution: 'local', modelDownloads: [] },
    renderPlan: { codec: 'libx264', requiresModelDownload: false },
    ffmpegPlans: [{
      sceneId: 'scene-1',
      renderPlan: { codec: 'libx264', requiresModelDownload: false },
      argv: [process.execPath, scriptPath, '-i', inputPath, outputPath],
    }],
    executionStatus: 'planned_only',
    status: 'planned_only',
  };
  const validation = validateRenderManifest({ manifest, approval });
  assert.equal(validation.status, 'planned_only');
  assert.equal(validation.planCount, 1);
  assert.equal(validation.plans[0].sceneId, 'scene-1');

  const execution = await executeRenderManifest({ manifest, approval });
  assert.equal(execution.status, 'completed');
  assert.equal(execution.receipts[0].ok, true);
  assert.equal(await readFile(outputPath, 'utf8'), 'fake-render:deterministic-media-input\n');
});

test('manifest validation refuses mock and remote media inputs', () => {
  const manifest = {
    manifestVersion: 1,
    projectId: 'local-manifest-project',
    hardwareProfile: { id: 'local-test', execution: 'local', modelDownloads: [] },
    renderPlan: { codec: 'libx264', requiresModelDownload: false },
    ffmpegPlans: [{
      sceneId: 'scene-1',
      renderPlan: { codec: 'libx264', requiresModelDownload: false },
      argv: ['/usr/bin/ffmpeg', '-i', '/tmp/input.fake-media', '/tmp/output.fake-media'],
    }],
    executionStatus: 'planned_only',
    status: 'planned_only',
  };
  assert.throws(() => validateRenderManifest({
    manifest: { ...manifest, ffmpegPlans: [{ ...manifest.ffmpegPlans[0], argv: ['/usr/bin/ffmpeg', '-i', 'mock://visual/scene-1.png', '/tmp/output.fake-media'] }] },
    approval,
  }), /non-local URI/);
  assert.throws(() => validateRenderManifest({
    manifest: { ...manifest, ffmpegPlans: [{ ...manifest.ffmpegPlans[0], argv: ['/usr/bin/ffmpeg', '-i', 'https://example.test/scene-1.png', '/tmp/output.fake-media'] }] },
    approval,
  }), /non-local URI/);
});

test('refuses mock-only hardware unless explicitly allowed and then succeeds', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-video-maker-mock-execution-test-'));
  const scriptPath = join(directory, 'fake-ffmpeg.js');
  await writeFile(scriptPath, 'process.stdout.write("fake-ok");\n', 'utf8');

  assert.throws(() => validateFfmpegExecution({
    ...base,
    argv: [process.execPath, scriptPath, '-i', join(directory, 'input.mov'), join(directory, 'output.mp4')],
    hardwareProfile: { execution: 'mock-only' },
  }), /mock-only/);

  const receipt = await executeFfmpeg({
    ...base,
    argv: [process.execPath, scriptPath, '-i', join(directory, 'input.mov'), join(directory, 'output.mp4')],
    hardwareProfile: { execution: 'mock-only' },
    allowMockExecution: true,
  });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.stdout, 'fake-ok');
});

test('bounds captured output to the requested byte limit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-video-maker-output-limit-test-'));
  const scriptPath = join(directory, 'fake-ffmpeg.js');
  await writeFile(scriptPath, 'process.stdout.write("0123456789");\n', 'utf8');
  const receipt = await executeFfmpeg({
    ...base,
    argv: [process.execPath, scriptPath, '-i', join(directory, 'input.mov'), join(directory, 'output.mp4')],
    maxOutputBytes: 5,
  });
  assert.ok(Buffer.byteLength(receipt.stdout, 'utf8') <= 5);
});
