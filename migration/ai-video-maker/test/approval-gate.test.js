import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ApprovalRequiredError, JsonApprovalGate } from '../src/approval-gate.js';

test('approval gate blocks until a human decision is recorded', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-video-maker-test-'));
  const gate = await new JsonApprovalGate(join(directory, 'approvals.json')).init();
  assert.throws(() => gate.assertApproved('p1', 'voice'), ApprovalRequiredError);

  const approval = await gate.request({ projectId: 'p1', stage: 'voice' });
  assert.equal(approval.status, 'pending');
  await gate.decide(approval.id, 'approved', { decidedBy: 'human-reviewer', note: 'Script accepted.' });
  assert.equal(gate.assertApproved('p1', 'voice').decidedBy, 'human-reviewer');
});
