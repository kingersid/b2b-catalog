import test from 'node:test';
import assert from 'node:assert/strict';
import { isSarvamRead, sarvamModelTools, stageSarvamMutation } from './sarvam-mcp.js';

test('Sarvam lifecycle actions cannot execute as reads', () => {
  assert.equal(isSarvamRead('campaigns', { operation: 'list_campaigns' }), true);
  assert.equal(isSarvamRead('campaigns', { operation: 'resume' }), false);
  assert.equal(isSarvamRead('agents', { operation: 'commit' }), false);
  assert.equal(isSarvamRead('configure_campaign', {}), false);
  const exposed = sarvamModelTools({ tools: ['campaigns','configure_campaign','upload_cohort','place_test_call','configure_agent']
    .map(name => ({ name, description: name, parameters: {} })) });
  assert.deepEqual(exposed.map(tool => tool.name), ['campaigns','configure_campaign','upload_cohort']);
});

test('first Sarvam cohort cannot include another number', async () => {
  const env = { CATALOG_DB: { prepare() { throw new Error('should not write'); } } };
  await assert.rejects(stageSarvamMutation(env, 'test-session-123', 'upload_cohort',
    { users: [{ phone: '+919537097267' }, { phone: '+919999999999' }] }), /only \+91 95370 97267/);
  await assert.rejects(stageSarvamMutation(env, 'test-session-123', 'place_test_call',
    { phone: '+919537097267' }), /not approved/);
});
