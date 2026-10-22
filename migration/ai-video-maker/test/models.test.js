import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createScene } from '../src/models.js';

test('models are JSON-compatible and retain project structure after round trip', () => {
  const project = createProject({
    id: 'project-1',
    title: 'Test project',
    scenes: [createScene({ id: 'scene-1', order: 1, title: 'Intro', narration: 'Hello' })],
  });
  const roundTrip = JSON.parse(JSON.stringify(project));
  assert.deepEqual(roundTrip, project);
  assert.equal(roundTrip.settings.aspectRatio, '9:16');
  assert.equal(roundTrip.scenes[0].narration, 'Hello');
});
