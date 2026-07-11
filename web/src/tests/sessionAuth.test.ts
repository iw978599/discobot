import test from 'node:test';
import assert from 'node:assert/strict';
import { assignRole, canControl, scopedRecipients } from '../sessionAuth';

test('permission matrix allows owner/collaborator/bot control', () => {
  assert.equal(canControl('owner'), true);
  assert.equal(canControl('collaborator'), true);
  assert.equal(canControl('bot'), true);
});

test('owner assignment is stable and collaborators are non-owner users', () => {
  assert.equal(assignRole(null, 'u1'), 'owner');
  assert.equal(assignRole('u1', 'u1'), 'owner');
  assert.equal(assignRole('u1', 'u2'), 'collaborator');
});

test('cross-guild isolation filters recipients', () => {
  const recipients = [
    { guildId: 'g1', type: 'ui' },
    { guildId: 'g2', type: 'ui' },
    { guildId: 'g1', type: 'bot' },
  ];

  const g1 = scopedRecipients('g1', recipients);
  assert.equal(g1.length, 2);
  assert.equal(g1.every((r) => r.guildId === 'g1'), true);
});
