import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, createScene } from './models.js';
import { JsonCheckpointStore } from './checkpoint-store.js';
import { JsonApprovalGate } from './approval-gate.js';
import { selectHardwareProfile } from './hardware.js';
import { VideoPipeline } from './pipeline.js';
import { runScenesFile } from './file-bridge.js';
import { writeRenderManifest } from './render-manifest.js';
import { auditFfmpegCapabilities, readRenderManifest, writeCapabilityReport } from './capability-audit.js';
import { readFile } from 'node:fs/promises';
import { executeRenderManifest, validateRenderManifest } from './ffmpeg-executor.js';

const args = parseArgs(process.argv.slice(2));

if (args.validateRender) {
  if (!args.renderManifest) throw new Error('--validate-render requires --render-manifest');
  if (!args.executionApproval) throw new Error('--validate-render requires --execution-approval');
  const renderManifest = await readRenderManifest(args.renderManifest);
  const executionApproval = JSON.parse(await readFile(args.executionApproval, 'utf8'));
  const validation = validateRenderManifest({
    manifest: renderManifest,
    approval: executionApproval,
    allowMockExecution: args.allowMockExecution,
    executablePath: args.ffmpegPath,
  });
  console.log(JSON.stringify({ ...validation, status: 'validated' }, null, 2));
} else if (args.executeRender) {
  if (!args.renderManifest) throw new Error('--execute-render requires --render-manifest');
  if (!args.executionApproval) throw new Error('--execute-render requires --execution-approval');
  const renderManifest = await readRenderManifest(args.renderManifest);
  const executionApproval = JSON.parse(await readFile(args.executionApproval, 'utf8'));
  const execution = await executeRenderManifest({
    manifest: renderManifest,
    approval: executionApproval,
    allowMockExecution: args.allowMockExecution,
    executablePath: args.ffmpegPath,
  });
  console.log(JSON.stringify(execution, null, 2));
} else if (args.capabilityAudit) {
  const renderManifest = args.renderManifest ? await readRenderManifest(args.renderManifest) : undefined;
  const report = await auditFfmpegCapabilities({
    ffmpegPath: args.ffmpegPath,
    renderManifest,
  });
  if (args.capabilityReport) await writeCapabilityReport(args.capabilityReport, report);
  console.log(JSON.stringify(report, null, 2));
} else if (args.scenes) {
  const result = await runScenesFile({
    scenesPath: args.scenes,
    checkpointPath: args.checkpoint,
    approvalPath: args.approval,
    approvalFilePath: args.approvalFile,
    approve: args.approve,
  });
  if (args.renderManifest) {
    if (result.result === null) throw new Error('Cannot write a render manifest until the scenes pipeline is completed; rerun with --approve.');
    await writeRenderManifest(args.renderManifest, result.result);
  }
  console.log(JSON.stringify(result, null, 2));
} else {
  const directory = await mkdtemp(join(tmpdir(), 'ai-video-maker-'));
  const project = createProject({
    id: 'demo-project',
    title: 'Migration scaffold demo',
    scenes: [createScene({ id: 'scene-1', order: 1, title: 'Opening', narration: 'A deterministic demo.', visualPrompt: 'A clean studio intro.' })],
  });
  const checkpoints = await new JsonCheckpointStore(join(directory, 'checkpoints.json')).init();
  const approvals = await new JsonApprovalGate(join(directory, 'approvals.json')).init();
  const approval = await approvals.request({ projectId: project.id, stage: 'voice', requestedBy: 'demo' });
  await approvals.decide(approval.id, 'approved', { decidedBy: 'demo' });
  const result = await new VideoPipeline({ checkpointStore: checkpoints, approvalGate: approvals, hardwareProfile: selectHardwareProfile('m1-lite') }).runProject(project);
  if (args.renderManifest) await writeRenderManifest(args.renderManifest, result);
  console.log(JSON.stringify({ ...result, checkpointDirectory: directory }, null, 2));
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const result = {
    scenes: undefined,
    checkpoint: undefined,
    approval: undefined,
    approvalFile: undefined,
    renderManifest: undefined,
    capabilityAudit: false,
    validateRender: false,
    capabilityReport: undefined,
    ffmpegPath: undefined,
    approve: false,
    executeRender: false,
    executionApproval: undefined,
    allowMockExecution: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--approve') {
      result.approve = true;
    } else if (argument === '--execute-render') {
      result.executeRender = true;
    } else if (argument === '--validate-render' || argument === '--validate-manifest') {
      result.validateRender = true;
    } else if (argument === '--execution-approval') {
      result.executionApproval = argv[++index];
    } else if (argument === '--allow-mock-execution') {
      result.allowMockExecution = true;
    } else if (argument === '--capability-audit') {
      result.capabilityAudit = true;
    } else if (argument === '--scenes') {
      result.scenes = argv[++index];
    } else if (argument === '--checkpoint') {
      result.checkpoint = argv[++index];
    } else if (argument === '--approval') {
      result.approval = argv[++index];
    } else if (argument === '--approval-file') {
      result.approvalFile = argv[++index];
    } else if (argument === '--render-manifest') {
      result.renderManifest = argv[++index];
    } else if (argument === '--capability-report' || argument === '--audit-report' || argument === '--report') {
      result.capabilityReport = argv[++index];
    } else if (argument === '--ffmpeg') {
      result.ffmpegPath = argv[++index];
    } else {
      throw new Error(`Unknown CLI argument: ${argument}`);
    }
  }
  return result;
}
