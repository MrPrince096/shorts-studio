import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptShortStudioScenesJson } from '../src/short-studio-adapter.js';

test('adapts a Short Studio scenes mapping without I/O and preserves project, scene, timeline, and asset data', () => {
  const input = {
    title: 'Launch story',
    dimensions: { width: 1080, height: 1920 },
    voice: { id: 'en-us-female' },
    scenes: {
      intro: { title: 'Opening', text: 'Welcome', query: 'bright studio', start: 1.5, duration: 3.25 },
      outro: { text: 'Thanks', query: 'sunset', startMs: 5000, durationMs: 2000 },
    },
  };

  const project = adaptShortStudioScenesJson(input, { projectId: 'launch-1' });

  assert.equal(project.id, 'launch-1');
  assert.equal(project.title, 'Launch story');
  assert.deepEqual(project.settings, {
    aspectRatio: '1080:1920',
    frameRate: 30,
    language: 'en-US',
    width: 1080,
    height: 1920,
    voice: 'en-us-female',
  });
  assert.deepEqual(project.scenes, [
    { id: 'intro', order: 1, title: 'Opening', narration: 'Welcome', visualPrompt: 'bright studio', durationMs: 3250 },
    { id: 'outro', order: 2, title: 'Scene 2', narration: 'Thanks', visualPrompt: 'sunset', durationMs: 2000 },
  ]);
  assert.deepEqual(project.timeline.map(({ sceneId, assetId, track, startMs, durationMs }) => ({ sceneId, assetId, track, startMs, durationMs })), [
    { sceneId: 'intro', assetId: 'launch-1-intro-visual', track: 'video', startMs: 1500, durationMs: 3250 },
    { sceneId: 'intro', assetId: 'launch-1-voice', track: 'audio', startMs: 1500, durationMs: 3250 },
    { sceneId: 'outro', assetId: 'launch-1-outro-visual', track: 'video', startMs: 5000, durationMs: 2000 },
    { sceneId: 'outro', assetId: 'launch-1-voice', track: 'audio', startMs: 5000, durationMs: 2000 },
  ]);
  assert.deepEqual(project.assets[0].metadata, {
    role: 'voice',
    voice: 'en-us-female',
    width: 1080,
    height: 1920,
  });
  assert.deepEqual(project.assets[1].metadata, {
    role: 'scene-visual',
    sourceSceneId: 'intro',
    query: 'bright studio',
    width: 1080,
    height: 1920,
    startMs: 1500,
    durationMs: 3250,
    sourceStart: 1.5,
    sourceDuration: 3.25,
  });
});

test('rejects invalid dimensions and empty scene mappings', () => {
  const base = { title: 'Invalid', dimensions: { width: 1080, height: 1920 }, scenes: { one: {} } };

  assert.throws(
    () => adaptShortStudioScenesJson({ ...base, dimensions: { width: 0, height: 1920 } }),
    /dimensions must contain positive integer width and height/,
  );
  assert.throws(
    () => adaptShortStudioScenesJson({ ...base, dimensions: { width: 1080.5, height: 1920 } }),
    /dimensions must contain positive integer width and height/,
  );
  assert.throws(
    () => adaptShortStudioScenesJson({ ...base, scenes: {} }),
    /must contain at least one scene/,
  );
});
