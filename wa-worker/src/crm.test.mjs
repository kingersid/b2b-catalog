import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { validateCrmPatch, playbook, ensureCrmOrders, updateCrmOrder, recordCrmEvent } from './crm.js';
import { validateScript, stageTerminal, confirmTerminal } from './terminal.js';

function environment(){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE wa_orders(id INTEGER PRIMARY KEY,party TEXT,location TEXT,notes TEXT,status TEXT DEFAULT 'pending',start_message_id TEXT,created_at INTEGER,updated_at INTEGER,completed_at INTEGER,capture_until INTEGER);
 INSERT INTO wa_orders(id,party,notes,start_message_id,created_at,updated_at) VALUES(1,'Test firm','Exact source message','source-1',100,100);`);
 db.exec(readFileSync(new URL('../crm.sql',import.meta.url),'utf8'));
 db.exec(`CREATE TABLE wa_operator_whatsapp_drafts(id TEXT PRIMARY KEY,status TEXT,last_error TEXT);
 CREATE TABLE wa_operator_sarvam_rest_actions(id TEXT PRIMARY KEY,status TEXT);`);
 const env={CATALOG_DB:{prepare(sql){let values=[];return {bind(...v){values=v;return this;},async first(){return db.prepare(sql).get(...values)||null;},async all(){return {results:db.prepare(sql).all(...values)};},async run(){const r=db.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}};}};}},OPERATOR_TERMINAL:{async run(){return {stdout:'4',stderr:'',exitCode:0};}}};
 return {env,db};
}
test('CRM rejects invalid phones, amounts, dates and status values',()=>{
 for(const patch of [{phone:'9537097267'},{amount_due:-1},{amount_due:'NaN'},{payment_status:'Maybe'},{next_action:'tomorrow'}])assert.throws(()=>validateCrmPatch(patch));
 assert.deepEqual(validateCrmPatch({phone:'+91 95370 97267',amount_due:1250,payment_status:'Pending'}),{payment_status:'Pending',phone:'+919537097267',amount_due:1250});
});
test('source capture and status playbooks are idempotent and never use owner number as buyer',async()=>{
 const {env,db}=environment();await ensureCrmOrders(env);await ensureCrmOrders(env);
 const o=db.prepare('SELECT * FROM wa_crm_orders').get();assert.equal(o.phone,null);assert.equal(o.products,'Exact source message');
 await updateCrmOrder(env,1,{payment_status:'Pending',amount_due:1250,phone:'+919537097267',customer_name:'Test',reviewed:true});
 assert.equal(db.prepare('SELECT COUNT(*) n FROM wa_crm_actions').get().n,1);
 await updateCrmOrder(env,1,{payment_status:'Paid'});
 assert.equal(db.prepare("SELECT kind FROM wa_crm_actions WHERE status='pending'").get().kind,'checklist');
 await updateCrmOrder(env,1,{order_status:'Complete'});
 assert.equal(db.prepare('SELECT status FROM wa_orders').get().status,'completed');
 assert.equal(db.prepare("SELECT COUNT(*) n FROM wa_crm_actions WHERE status='pending'").get().n,0);
});
test('delivery events deduplicate without claiming payment or dispatch',async()=>{
 const {env,db}=environment();await ensureCrmOrders(env);
 const event={id:'meta:1:delivered',orderId:1,channel:'whatsapp',outcome:'delivered',details:'Delivered'};
 await recordCrmEvent(env,event);await recordCrmEvent(env,event);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM wa_crm_events').get().n,1);
 assert.equal(db.prepare('SELECT payment_status FROM wa_crm_orders').get().payment_status,'Unknown');
});
test('script confirmation is session-bound and cannot execute twice',async()=>{
 const {env,db}=environment();let executions=0;env.OPERATOR_TERMINAL.run=async()=>{executions++;return {stdout:'4',stderr:'',exitCode:0};};
 const draft=await stageTerminal(env,'session_test',{runtime:'node',code:'console.log(2+2)'});
 await assert.rejects(()=>confirmTerminal(env,draft.id,'other_session'));
 assert.equal(executions,0);await confirmTerminal(env,draft.id,'session_test');
 await assert.rejects(()=>confirmTerminal(env,draft.id,'session_test'));assert.equal(executions,1);
 assert.equal(db.prepare('SELECT stdout FROM wa_terminal_runs').get().stdout,'4');
 assert.throws(()=>validateScript({runtime:'shell',code:'echo hello'}));
 assert.throws(()=>validateScript({runtime:'node',code:'x'.repeat(8193)}));
});
test('terminal enforces a single running script globally',async()=>{
 const {env,db}=environment();
 db.prepare("INSERT INTO wa_terminal_runs(id,session_id,runtime,code,status,created_at,updated_at) VALUES('run1','session_test','node','1','running',1,1)").run();
 const draft=await stageTerminal(env,'session_test',{runtime:'python',code:'print(4)'});
 await assert.rejects(()=>confirmTerminal(env,draft.id,'session_test'));
});
test('playbooks require real lifecycle states',()=>{
 assert.equal(playbook({order_status:'Complete',payment_status:'Overdue'}).length,0);
 assert.equal(playbook({order_status:'New',payment_status:'Overdue'})[0].kind,'call');
 assert.equal(playbook({order_status:'Processing',payment_status:'Paid',dispatch_status:'Dispatched'})[0].kind,'tracking');
});
