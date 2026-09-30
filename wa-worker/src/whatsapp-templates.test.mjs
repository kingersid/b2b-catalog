import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { confirmWhatsAppTemplate, PAYMENT_TEMPLATE_BODY, PAYMENT_TEMPLATE_NAME, prepareWhatsAppTemplate, renderTemplate, validateRecipient } from './whatsapp-templates.js';

globalThis.crypto ||= webcrypto;

function fixture() {
  const rows = new Map();
  const calls = [];
  const guards = { conversation: null, crm: null };
  const template = { name: PAYMENT_TEMPLATE_NAME, language: 'hi', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: PAYMENT_TEMPLATE_BODY }] };
  const db = { prepare(sql) { return { bind(...args) { return {
    async run() {
      if (sql.includes('INSERT INTO wa_operator_whatsapp_drafts')) {
        rows.set(args[0], { id: args[0], session_id: args[1], to_wa_id: args[2], template_name: args[3], language: args[4], parameters_json: args[5], preview: args[6], category: args[7], status: 'pending', created_at: args[8] });
      } else if (sql.includes("status = 'sending'")) {
        const row = rows.get(args[1]);
        if (row?.status !== 'pending') return { meta: { changes: 0 } };
        row.status = 'sending';
      } else if (sql.includes("status = 'sent'")) rows.get(args[2]).status = 'sent';
      else if (sql.includes("status = 'unknown'")) rows.get(args[2]).status = 'unknown';
      return { meta: { changes: 1 } };
    },
    async first() { if(sql.includes('FROM wa_conversations'))return guards.conversation;if(sql.includes('FROM wa_crm_actions'))return guards.crm;return rows.get(args[0]); },
  }; } }; } };
  const env = { CATALOG_DB: db, META_ACCESS_TOKEN: 'test-token', WABA_ID: 'waba', PHONE_NUMBER_ID: 'phone' };
  const fetchFn = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.headers.authorization, 'Bearer test-token');
    if (url.includes('/message_templates')) return Response.json({ data: [template] });
    if (url.endsWith('/messages')) return Response.json({ messages: [{ id: 'wamid.test' }] });
    throw new Error('Unexpected Graph request');
  };
  return { rows, calls, template, env, fetchFn, guards };
}

test('Hindi payment template is rendered exactly and recipient requires country code', () => {
  const { template } = fixture();
  assert.equal(validateRecipient('+91 95370 97267'), '919537097267');
  assert.throws(() => validateRecipient('9537097267'), /country code/);
  assert.equal(renderTemplate(template, ['सीमा जी', '15 सितंबर 2026', '12,500']),
    'नमस्ते सीमा जी,\n\nचाँदनी सिल्क मिल्स से कपड़ों का ऑर्डर देने के लिए धन्यवाद। हमारे रिकॉर्ड के अनुसार, दिनांक 15 सितंबर 2026 के आपके ऑर्डर की ₹12,500 राशि का भुगतान लंबित है। कृपया बताएं कि भुगतान कब तक हो सकेगा।\n\nधन्यवाद,\nचाँदनी सिल्क मिल्स');
});

test('opt-out or changed CRM order blocks an already-prepared reminder', async () => {
 for(const kind of ['optout','changed']){
  const {env,fetchFn,guards,calls}=fixture();
  const draft=await prepareWhatsAppTemplate(env,'session_test',{to:'919537097267',template_name:PAYMENT_TEMPLATE_NAME,language:'hi',body_parameters:['Test','1 October 2026','100']},fetchFn);
  if(kind==='optout')guards.conversation={mode:'optout'};
  else guards.crm={revision:1,current_revision:2,confidence:'verified',phone:'+919537097267'};
  await assert.rejects(()=>confirmWhatsAppTemplate(env,draft.id,true,fetchFn),kind==='optout'?/opted out/:/Order changed/);
  assert.equal(calls.filter(c=>c.url.endsWith('/messages')).length,0);
 }
});

test('agent draft does not send; confirmation sends approved template once', async () => {
  const { rows, calls, env, fetchFn } = fixture();
  const draft = await prepareWhatsAppTemplate(env, 'test-session', { to: '+91 95370 97267', template_name: PAYMENT_TEMPLATE_NAME, language: 'hi', body_parameters: ['सीमा जी', '15 सितंबर 2026', '12,500'] }, fetchFn);
  assert.equal(draft.to, '919537097267');
  assert.equal(calls.filter(call => call.url.endsWith('/messages')).length, 0);
  await assert.rejects(() => confirmWhatsAppTemplate(env, draft.id, false, fetchFn), /agreed/);
  const result = await confirmWhatsAppTemplate(env, draft.id, true, fetchFn);
  assert.equal(result.messageId, 'wamid.test');
  assert.equal(rows.get(draft.id).status, 'sent');
  const sends = calls.filter(call => call.url.endsWith('/messages'));
  assert.equal(sends.length, 1);
  assert.deepEqual(JSON.parse(sends[0].options.body), { messaging_product: 'whatsapp', to: '919537097267', type: 'template', template: { name: PAYMENT_TEMPLATE_NAME, language: { code: 'hi' }, components: [{ type: 'body', parameters: ['सीमा जी', '15 सितंबर 2026', '12,500'].map(text => ({ type: 'text', text })) }] } });
  await assert.rejects(() => confirmWhatsAppTemplate(env, draft.id, true, fetchFn), /no longer available/);
  assert.equal(calls.filter(call => call.url.endsWith('/messages')).length, 1);
});

test('unapproved or changed template cannot be sent', async () => {
  const { template, env, fetchFn } = fixture();
  template.status = 'PENDING';
  await assert.rejects(() => prepareWhatsAppTemplate(env, 'test-session', { to: '919537097267', template_name: PAYMENT_TEMPLATE_NAME, language: 'hi', body_parameters: ['सीमा जी', '15 सितंबर 2026', '12,500'] }, fetchFn), /wait for Meta approval/);
  template.status = 'APPROVED';
  const draft = await prepareWhatsAppTemplate(env, 'test-session', { to: '919537097267', template_name: PAYMENT_TEMPLATE_NAME, language: 'hi', body_parameters: ['सीमा जी', '15 सितंबर 2026', '12,500'] }, fetchFn);
  template.components[0].text += ' नया पाठ';
  await assert.rejects(() => confirmWhatsAppTemplate(env, draft.id, true, fetchFn), /Template changed/);
});
