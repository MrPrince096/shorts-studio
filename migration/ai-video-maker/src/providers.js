// @ts-check

import { createArtifact } from './models.js';

function stableToken(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Provider-neutral deterministic adapters. Real providers can implement these same methods.
 * No network, credentials, or model files are used.
 */
export function createMockProviders() {
  return {
    script: {
      async generate(project) {
        return { text: `Script for ${project.title}: ${project.scenes.map((scene) => scene.narration).join(' ')}` };
      },
    },
    voice: {
      async synthesize(scene) {
        return { uri: `mock://voice/${scene.id}.wav`, durationMs: scene.durationMs, voiceId: 'mock-neutral' };
      },
    },
    captions: {
      async generate(scene) {
        return { cues: [{ startMs: 0, endMs: scene.durationMs, text: scene.narration }] };
      },
    },
    visuals: {
      async generate(scene) {
        return { uri: `mock://visual/${scene.id}.png`, prompt: scene.visualPrompt };
      },
    },
    render: {
      async render(project, scene, inputs) {
        const token = stableToken(`${project.id}:${scene.id}:${inputs.join(',')}`);
        return { uri: `mock://render/${project.id}/${scene.id}-${token}.mp4`, codec: 'mock-h264', inputs };
      },
    },
  };
}

export function artifactFor({ projectId, stage, sceneId = null, kind, uri, metadata = {} }) {
  const id = ['artifact', projectId, stage, sceneId ?? 'project'].join('-');
  return createArtifact({
    id,
    projectId,
    stage,
    sceneId,
    kind,
    uri,
    checksum: stableToken(JSON.stringify({ id, uri, metadata })),
    metadata,
  });
}
