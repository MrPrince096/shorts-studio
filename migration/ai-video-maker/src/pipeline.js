// @ts-check

import { artifactFor, createMockProviders } from './providers.js';
import { selectHardwareProfile } from './hardware.js';
import { planRender } from './render-planner.js';
import { planFfmpegCommand } from './ffmpeg-planner.js';

const SCENE_STAGES = ['voice', 'captions', 'visuals', 'render'];

export class VideoPipeline {
  /** @param {{checkpointStore: import('./checkpoint-store.js').JsonCheckpointStore, approvalGate: import('./approval-gate.js').JsonApprovalGate, providers?: ReturnType<typeof createMockProviders>, hardwareProfile?: ReturnType<typeof selectHardwareProfile>, renderPlan?: import('./render-planner.js').RenderPlan, renderCapabilityPlan?: import('./render-planner.js').RenderPlan, platform?: string, availableEncoders?: string[]}} options */
  constructor(options) {
    this.checkpointStore = options.checkpointStore;
    this.approvalGate = options.approvalGate;
    this.providers = options.providers ?? createMockProviders();
    this.hardwareProfile = options.hardwareProfile ?? selectHardwareProfile('m1-lite');
    this.renderPlan = options.renderPlan ?? options.renderCapabilityPlan ?? planRender({
      platform: options.platform ?? 'darwin',
      hardwareProfile: this.hardwareProfile,
      availableEncoders: options.availableEncoders ?? ['h264_videotoolbox', 'libx264'],
    });
    /** @type {{sceneId: string, plan: import('./render-planner.js').RenderPlan, command: string[]}[]} */
    this.ffmpegPlans = [];
  }

  /** @param {import('./models.js').Project} project */
  async runProject(project) {
    /** @type {import('./models.js').Artifact[]} */
    const artifacts = [];

    if (!this.checkpointStore.isStageComplete(project.id, 'script')) {
      await this.checkpointStore.checkpointStage({ projectId: project.id, stage: 'script', status: 'running' });
      const result = await this.providers.script.generate(project);
      const artifact = artifactFor({ projectId: project.id, stage: 'script', kind: 'script', uri: `mock://script/${project.id}.json`, metadata: { text: result.text } });
      artifacts.push(artifact);
      await this.checkpointStore.checkpointStage({ projectId: project.id, stage: 'script', status: 'completed', artifactIds: [artifact.id] });
    }

    // The approval is intentionally checked after the cheap script stage and before voice generation.
    this.approvalGate.assertApproved(project.id, 'voice');

    for (const stage of SCENE_STAGES) {
      if (this.checkpointStore.isStageComplete(project.id, stage)) continue;
      await this.checkpointStore.checkpointStage({ projectId: project.id, stage, status: 'running' });

      for (const scene of project.scenes) {
        if (this.checkpointStore.isSceneComplete(project.id, stage, scene.id)) continue;
        await this.checkpointStore.checkpointScene({ projectId: project.id, stage, sceneId: scene.id, status: 'running' });
        let artifact;
        if (stage === 'voice') {
          const result = await this.providers.voice.synthesize(scene);
          artifact = artifactFor({ projectId: project.id, stage, sceneId: scene.id, kind: 'audio', uri: result.uri, metadata: result });
        } else if (stage === 'captions') {
          const result = await this.providers.captions.generate(scene);
          artifact = artifactFor({ projectId: project.id, stage, sceneId: scene.id, kind: 'captions', uri: `mock://captions/${scene.id}.json`, metadata: result });
        } else if (stage === 'visuals') {
          const result = await this.providers.visuals.generate(scene);
          artifact = artifactFor({ projectId: project.id, stage, sceneId: scene.id, kind: 'visual', uri: result.uri, metadata: result });
        } else {
          const result = await this.providers.render.render(project, scene, [`voice:${scene.id}`, `captions:${scene.id}`, `visuals:${scene.id}`]);
          const sceneArtifacts = artifacts.filter((candidate) => candidate.sceneId === scene.id);
          const audioInput = sceneArtifacts.find((candidate) => candidate.stage === 'voice')?.uri
            ?? `mock://voice/${scene.id}.wav`;
          const captionInput = sceneArtifacts.find((candidate) => candidate.stage === 'captions')?.uri
            ?? `mock://captions/${scene.id}.json`;
          const visualInput = sceneArtifacts.find((candidate) => candidate.stage === 'visuals')?.uri
            ?? `mock://visual/${scene.id}.png`;
          const commandPlan = planFfmpegCommand({
            renderPlan: this.renderPlan,
            dimensions: {
              width: project.settings.width ?? project.dimensions?.width ?? 1080,
              height: project.settings.height ?? project.dimensions?.height ?? 1920,
            },
            fps: project.settings.frameRate ?? 30,
            inputArtifacts: [visualInput],
            audioInputs: [audioInput],
            captionInputs: [captionInput],
            outputPath: result.uri,
          });
          this.ffmpegPlans.push({ sceneId: scene.id, plan: commandPlan.renderPlan, command: commandPlan.argv });
          artifact = artifactFor({ projectId: project.id, stage, sceneId: scene.id, kind: 'video', uri: result.uri, metadata: result });
        }
        artifacts.push(artifact);
        await this.checkpointStore.checkpointScene({ projectId: project.id, stage, sceneId: scene.id, status: 'completed', artifactIds: [artifact.id] });
      }
      await this.checkpointStore.checkpointStage({ projectId: project.id, stage, status: 'completed', artifactIds: project.scenes.map((scene) => `artifact-${project.id}-${stage}-${scene.id}`) });
    }

    return {
      projectId: project.id,
      hardwareProfile: this.hardwareProfile,
      renderPlan: this.renderPlan,
      ffmpegPlans: this.ffmpegPlans,
      artifacts,
      status: 'completed',
    };
  }
}
