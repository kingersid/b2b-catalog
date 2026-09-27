import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = name => fs.readFileSync(new URL(name, import.meta.url), 'utf8');
const run = (name, json, nodes) => vm.runInNewContext(`(() => { ${source(name)} })()`, {
  $json: json,
  $: node => ({ first: () => ({ json: nodes[node] }) }),
  Object, Array, String, Number, Map, Set, JSON, Date, encodeURIComponent
});
const catalog = { designs: [
  { design_id: 'active', name: 'Floral.jpg', url: 'https://example.com/active.jpg' },
  { design_id: 'hidden', name: 'Hidden.jpg', url: 'https://example.com/hidden.jpg' },
  { design_id: 'unpriced', name: 'Plain.jpg', url: 'https://example.com/plain.jpg' }
] };
const request = { sender: '919999999999', text: 'Show floral designs' };
const context = run('brain-context.js', { prices: { active: 950, hidden: 0 } }, {
  'Parse Message': request, 'Get Active Designs': catalog
})[0].json;
assert.equal(context.eligible.length, 1);
assert.equal(context.modelInput.designs[0].id, 'active');
assert.equal(JSON.stringify(context.modelInput).includes('950'), false);
assert.equal(JSON.stringify(context.modelInput).includes(request.sender), false);

const reply = decision => run('brain-replies.js', {
  output: [{ content: [{ type: 'output_text', text: JSON.stringify(decision) }] }]
}, { 'Build AI Context': context });
const rows = reply({ action: 'show_designs', design_ids: ['hidden', 'active'], question: 'general' });
assert.equal(rows.length, 1);
assert.match(rows[0].json.payload.image.caption, /₹950/);
assert.doesNotMatch(rows[0].json.payload.image.caption, /hidden/);
assert.equal(reply({ action: 'stop', design_ids: [], question: 'general' }).length, 0);
assert.match(reply({ action: 'clarify', design_ids: [], question: 'color' })[0].json.payload.text.body, /colour/i);
const failed = run('brain-replies.js', { error: 'API unavailable' }, { 'Build AI Context': context });
assert.equal(failed.length, 1);
assert.match(failed[0].json.payload.image.caption, /₹950/);

const workflow = JSON.parse(source('whatsapp-catalog-agent.json'));
assert.equal(workflow.nodes.find(n => n.name === 'Ask GPT-5.6').continueOnFail, true);
assert.equal(workflow.connections['Get Rates'].main[0][0].node, 'Build AI Context');
assert.equal(workflow.connections['Ask GPT-5.6'].main[0][0].node, 'Prepare Catalog Replies');
console.log('Brain workflow tests passed');
