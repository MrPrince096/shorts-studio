import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

test('demo CLI writes a planned-only render manifest without executing FFmpeg', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-video-maker-cli-test-'));
  const manifestPath = join(directory, 'render-manifest.json');
  const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const { stdout } = await execFileAsync(process.execPath, [cliPath, '--render-manifest', manifestPath], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
  });

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.executionStatus, 'planned_only');
  assert.equal(manifest.hardwareProfile.execution, 'mock-only');
  assert.equal(manifest.ffmpegPlans.length, 1);
  assert.ok(stdout.includes('"status": "completed"'));
});

test('CLI refuses manifest validation without an explicit approval JSON path', async () => {
  const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  await assert.rejects(
    execFileAsync(process.execPath, [
      cliPath,
      '--validate-render',
      '--render-manifest', '/tmp/local-render-manifest.json',
    ], { cwd: fileURLToPath(new URL('..', import.meta.url)) }),
    (error) => String(error.stderr).includes('--validate-render requires --execution-approval'),
  );
});

test('CLI executes a reviewed local manifest only with explicit approval', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-video-maker-cli-execute-test-'));
  const fakePath = join(directory, 'fake-ffmpeg.js');
  const manifestPath = join(directory, 'local-render-manifest.json');
  const approvalPath = join(directory, 'execution-approval.json');
  await writeFile(fakePath, 'process.stdout.write("cli-fake-ok");\n', 'utf8');
  await chmod(fakePath, 0o755);
  await writeFile(manifestPath, JSON.stringify({
    manifestVersion: 1,
    projectId: 'cli-execution-project',
    hardwareProfile: { id: 'local', execution: 'local', modelDownloads: [] },
    renderPlan: { codec: 'libx264', requiresModelDownload: false },
    ffmpegPlans: [{
      sceneId: 'scene-1',
      renderPlan: { codec: 'libx264', requiresModelDownload: false },
      argv: [process.execPath, fakePath, '-i', join(directory, 'input.mov'), join(directory, 'output.mp4')],
    }],
    executionStatus: 'planned_only',
    status: 'planned_only',
  }), 'utf8');
  await writeFile(approvalPath, JSON.stringify({ approved: true, executionMode: 'local-ffmpeg' }), 'utf8');

  const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const validation = await execFileAsync(process.execPath, [
    cliPath,
    '--validate-render',
    '--render-manifest', manifestPath,
    '--execution-approval', approvalPath,
  ], { cwd: fileURLToPath(new URL('..', import.meta.url)) });
  assert.equal(JSON.parse(validation.stdout).status, 'validated');
  assert.equal(JSON.parse(validation.stdout).planCount, 1);

  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    '--execute-render',
    '--render-manifest', manifestPath,
    '--execution-approval', approvalPath,
  ], { cwd: fileURLToPath(new URL('..', import.meta.url)) });
  const execution = JSON.parse(stdout);
  assert.equal(execution.status, 'completed');
  assert.equal(execution.receipts[0].ok, true);
  assert.equal(execution.receipts[0].stdout, 'cli-fake-ok');
});
