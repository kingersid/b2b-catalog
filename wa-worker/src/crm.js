import { seal, unseal } from './mcp-oauth.js';
import { prepareWhatsAppTemplate, PAYMENT_TEMPLATE_NAME } from './whatsapp-templates.js';
import { stageSarvamRest } from './sarvam-rest.js';
import { storedMcpConnection } from './mcp-oauth.js';
import { connectMcp, callMcpTool } from './mcp.js';

export async function crmWorkspaceCall(env,name,args){
 const configured=await storedMcpConnection(env);if(!configured)throw new Error('Connect Notion in the admin inbox first');
 const c=await connectMcp(env,fetch,configured);const raw=JSON.parse(await callMcpTool(c,name,args));
 if(raw.isError)throw new Error('Notion: '+raw.content.slice(0,400));
 return raw.content;
}
function decodeMcp(raw){try{return JSON.parse(raw);}catch{return {text:raw};}}
const entityId=value=>String(value||'').match(/[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}/i)?.[0];
const flatProperties=properties=>Object.fromEntries(Object.entries(properties).flatMap(([name,p])=>{
 if(p.title||p.rich_text)return [[name,(p.title||p.rich_text).map(t=>t.text?.content||t.plain_text||'').join('')]];
 if('date'in p)return [['date:'+name+':start',p.date?.start||null],['date:'+name+':is_datetime',p.date?.start?.includes('T')?1:0]];
 return [[name,p.select?.name??p.phone_number??p.number??null]];
}));
async function mcpNotion(env,config,path,body){
 const invoke=async(name,args)=>decodeMcp(await crmWorkspaceCall(env,name,args));
 if(path.startsWith('data_sources/')&&path.endsWith('/query')){
  const result=await invoke('notion-query-data-sources',{data:{data_source_urls:['collection://'+config.data_source_id],query:'SELECT url FROM "collection://'+config.data_source_id+'" WHERE "Order ID" = ? LIMIT 2',params:[body.filter.property==='Order ID'?body.filter.title.equals:'']}});
  const rows=result.results||result.rows||[];
  return {results:rows.map(r=>({id:entityId(r.url||r.id)})).filter(r=>r.id)};
 }
 if(path==='pages'){
  const result=await invoke('notion-create-pages',{parent:{data_source_id:config.data_source_id},pages:[{properties:flatProperties(body.properties)}],allow_async:false});
  const page=result.pages?.[0];const id=page?.id||entityId(page?.url);if(!id)throw new Error('Notion page creation response was uncertain; review the database before retrying');return {id};
 }
 if(path.startsWith('pages/')&&body){const id=path.slice(6);await invoke('notion-update-page',{page_id:id,command:'update_properties',properties:flatProperties(body.properties),allow_async:false});return {id};}
 return invoke('notion-fetch',{id:path.split('/').at(-1)});
}
export async function configureWorkspaceCrm(env,input){
 const previous=await env.CATALOG_DB.prepare('SELECT * FROM wa_crm_config WHERE id=1').first();
 if(previous?.data_source_id)return {connected:true,databaseId:previous.database_id};
 if(previous?.database_id==='CREATING'){
  const page=decodeMcp(await crmWorkspaceCall(env,'notion-fetch',{id:previous.parent_id}));
  const match=String(page.text||'').match(/<database url="https:\/\/(?:app\.notion\.com\/p|www\.notion\.so)\/([a-f0-9-]+)"[^>]*data-source-url="collection:\/\/([a-f0-9-]+)"[^>]*>Chandni Orders<\/database>/);
  if(!match)throw new Error('Previous setup may have created a database. Inspect Notion before retrying to avoid duplicates.');
  await env.CATALOG_DB.prepare("UPDATE wa_crm_config SET database_id=?,data_source_id=? WHERE id=1 AND database_id='CREATING'").bind(match[1],match[2]).run();return {connected:true,databaseId:match[1],dataSourceId:match[2]};
 }
 const parent=uuid(previous?.parent_id||input.parentId||'3eb488352cd3807f9882d063e7104149');
 const fetched=decodeMcp(await crmWorkspaceCall(env,'notion-fetch',{id:parent}));
 let parentId=parent;
 if(fetched.metadata?.type==='database'){
  const source=String(fetched.text||'').match(/collection:\/\/([a-f0-9-]{36})/i)?.[1];if(!source)throw new Error('Parent database data source not found');
  const made=decodeMcp(await crmWorkspaceCall(env,'notion-create-pages',{parent:{data_source_id:source},pages:[{properties:{Name:'Chandni Orders workspace'}}],allow_async:false}));
  parentId=made.pages?.[0]?.id||entityId(made.pages?.[0]?.url);if(!parentId)throw new Error('Could not identify the new CRM workspace page');
 }
 const claimed=await env.CATALOG_DB.prepare("INSERT INTO wa_crm_config(id,api_key,parent_id,database_id,updated_at) VALUES(1,'',?,'CREATING',?) ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,database_id='CREATING',updated_at=excluded.updated_at WHERE wa_crm_config.database_id IS NULL").bind(parentId,now()).run();if(!claimed.meta.changes)throw new Error('CRM setup already started');
 const cols=['"Order ID" TITLE','"Customer name" RICH_TEXT','"WhatsApp number" PHONE_NUMBER','"Firm / city" RICH_TEXT','"Products" RICH_TEXT','"Order date" DATE','"Amount due" NUMBER','"Next action" DATE','"Notes" RICH_TEXT','"Last contact" DATE','"Source message ID" RICH_TEXT'];
 for(const [field,values]of Object.entries(CRM_STATUSES)){const name=field.replace(/_/g,' ').replace(/^./,s=>s.toUpperCase());cols.push('"'+name+'" SELECT('+values.map(v=>"'"+v+"'").join(',')+')');}
 const result=decodeMcp(await crmWorkspaceCall(env,'notion-create-database',{parent:{page_id:parentId},title:'Chandni Orders',schema:'CREATE TABLE "Chandni Orders" ('+cols.join(',')+');'}));
 const source=JSON.stringify(result).match(/collection:\/\/([a-f0-9-]{36})/i)?.[1];
 const database=entityId(result.url||result.database?.url||result.id||result.databaseUrl||JSON.stringify(result).match(/https:\/\/(?:app\.notion\.com\/p|www\.notion\.so)\/([a-f0-9-]+)/)?.[1]);
 if(!source||!database)throw new Error('Notion database response needs review; setup will not retry automatically');
 await env.CATALOG_DB.prepare("UPDATE wa_crm_config SET api_key='',database_id=?,data_source_id=? WHERE id=1").bind(database,source).run();
 return {connected:true,databaseId:database,dataSourceId:source};
}

const now = () => Math.floor(Date.now()/1000);
const text = value => ({rich_text: [{text:{content:String(value || '').slice(0,1900)}}]});
const date = value => ({date:value ? {start:value} : null});
const uuid = value => {
  const raw=String(value||'').replace(/-/g,'');
  if(!/^[a-f0-9]{32}$/i.test(raw)) throw new Error('Enter a valid Notion page or database ID');
  return raw;
};
export const CRM_STATUSES = {
 payment_status:['Pending','Part paid','Paid','Overdue','Unknown'],
 dispatch_status:['Not ready','Packed','Dispatched','Delivered','Hold'],
 order_status:['New','Confirmed','Processing','Complete','Cancelled'],
};
export function validateCrmPatch(input) {
 const out={};
 for(const [field,values] of Object.entries(CRM_STATUSES)) if(field in input){if(!values.includes(input[field]))throw new Error('Invalid '+field);out[field]=input[field];}
 for(const field of ['customer_name','products'])if(field in input)out[field]=String(input[field]||'').slice(0,1900);
 if('phone' in input){const p=String(input.phone||'').replace(/[\s()-]/g,'');if(p&&!/^\+[1-9]\d{7,14}$/.test(p))throw new Error('Use an E.164 phone number including + and country code');out.phone=p||null;}
 if('amount_due' in input){const n=input.amount_due===null||input.amount_due===''?null:Number(input.amount_due);if(n!==null&&(!Number.isFinite(n)||n<0))throw new Error('Amount due must be nonnegative');out.amount_due=n;}
 if('next_action' in input){const v=input.next_action;if(v&&!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(v))throw new Error('Use an ISO date');if(v&&!Number.isFinite(Date.parse(v)))throw new Error('Invalid date');out.next_action=v||null;}
 if(input.reviewed===true)out.confidence='verified';
 return out;
}
export function playbook(order){
 if(order.order_status==='Cancelled'||order.order_status==='Complete')return [];
 if(order.payment_status==='Overdue')return [{kind:'call',reason:'Overdue payment',preview:'Ask the customer for a payment date. Amount due: '+(order.amount_due??'not recorded')+' INR.'}];
 if(['Pending','Part paid'].includes(order.payment_status))return [{kind:'payment',reason:'Payment pending',preview:'Payment reminder for '+(order.customer_name||order.party||'customer')+'; amount due '+(order.amount_due??'not recorded')+' INR.'}];
 if(order.dispatch_status==='Dispatched')return [{kind:'tracking',reason:'Dispatched',preview:'Review tracking number and carrier before sending a dispatch confirmation.'}];
 if(order.payment_status==='Paid')return [{kind:'checklist',reason:'Payment received',preview:'Verify products and quantities, pack the order, confirm address and carrier, then record dispatch.'}];
 return [];
}
export async function ensureCrmOrders(env){
 await env.CATALOG_DB.prepare(`INSERT OR IGNORE INTO wa_crm_orders(order_id,customer_name,products,order_status,next_action)
 SELECT id,party,notes,CASE WHEN status='completed' THEN 'Complete' ELSE 'New' END,
 strftime('%Y-%m-%d',created_at,'unixepoch','+1 day','+330 minutes') FROM wa_orders`).run();
 // Legacy order capture keeps its source text and stable reference; never infer a buyer phone from the owner sender.
 await env.CATALOG_DB.prepare(`UPDATE wa_crm_orders SET revision=revision+1 WHERE order_id IN
 (SELECT o.id FROM wa_orders o WHERE o.updated_at > wa_crm_orders.synced_at)
 AND revision=sync_revision`).run();
}
export async function crmOverview(env){
 await ensureCrmOrders(env);
 const {results:orders}=await env.CATALOG_DB.prepare(`SELECT c.*,o.party,o.location,o.notes,o.start_message_id,o.created_at,o.updated_at,o.status FROM wa_crm_orders c JOIN wa_orders o ON o.id=c.order_id ORDER BY o.created_at DESC LIMIT 200`).all();
 const {results:actions}=await env.CATALOG_DB.prepare("SELECT * FROM wa_crm_actions WHERE status='pending' AND expires_at>? ORDER BY created_at DESC LIMIT 100").bind(now()).all();
 const config=await env.CATALOG_DB.prepare('SELECT database_id,data_source_id FROM wa_crm_config WHERE id=1').first();
 const {results:digests}=await env.CATALOG_DB.prepare('SELECT day,status,summary FROM wa_crm_digest ORDER BY day DESC LIMIT 7').all();
 return {connected:Boolean(config?.data_source_id),databaseId:config?.database_id,orders,actions,digests};
}
export async function updateCrmOrder(env,id,input){
 if(!Number.isSafeInteger(id)||id<1)throw new Error('Invalid order');
 await ensureCrmOrders(env);
 const patch=validateCrmPatch(input), keys=Object.keys(patch);
 if(!keys.length)throw new Error('No order changes supplied');
 const changed=await env.CATALOG_DB.prepare(`UPDATE wa_crm_orders SET ${keys.map(k=>k+'=?').join(',')},revision=revision+1 WHERE order_id=?`).bind(...keys.map(k=>patch[k]),id).run();
 if(!changed.meta.changes)throw new Error('Order not found');
 if(patch.order_status==='Complete'||patch.order_status==='Cancelled')await env.CATALOG_DB.prepare("UPDATE wa_orders SET status='completed',completed_at=?,updated_at=?,capture_until=? WHERE id=?").bind(now(),now(),now()-1,id).run();
 await stageCrmPlaybooks(env,id);
 return {saved:true};
}
async function notion(env,path,body,fetchFn=fetch){
 const c=await env.CATALOG_DB.prepare('SELECT * FROM wa_crm_config WHERE id=1').first();
 if(c?.api_key===''&&c.data_source_id)return mcpNotion(env,c,path,body);
 const key=c?.api_key?await unseal(c.api_key,env.AGENT_ADMIN_KEY):env.NOTION_API_KEY;
 if(!key)throw new Error('Connect a Notion integration in CRM setup first');
 const r=await fetchFn('https://api.notion.com/v1/'+path,{method:body===undefined?'GET':path.startsWith('pages/')?'PATCH':'POST',signal:AbortSignal.timeout(15000),headers:{authorization:'Bearer '+key,'Notion-Version':'2025-09-03','content-type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 if(!r.ok)throw new Error('Notion request failed ('+r.status+'). Check integration access.');
 return r.json();
}
export function notionSchema(){
 const p={'Order ID':{title:{}}};
 for(const name of ['Customer name','Firm / city','Products','Notes','Source message ID'])p[name]={rich_text:{}};
 p['WhatsApp number']={phone_number:{}};p['Amount due']={number:{format:'number'}};
 for(const name of ['Order date','Next action','Last contact'])p[name]={date:{}};
 for(const [field,values]of Object.entries(CRM_STATUSES)){const name=field.split('_').map((s,i)=>i?s:s[0].toUpperCase()+s.slice(1)).join(' ');p[name]={select:{options:values.map(name=>({name}))}};}
 return p;
}
export async function configureCrm(env,input,fetchFn=fetch){
 if(!input.apiKey&&!input.databaseId&&!env.NOTION_API_KEY)return configureWorkspaceCrm(env,input);
 const previous=await env.CATALOG_DB.prepare('SELECT * FROM wa_crm_config WHERE id=1').first();
 if(previous?.data_source_id&&!input.databaseId) return {connected:true,databaseId:previous.database_id};
 const key=String(input.apiKey||'').trim();
 if(key&& (key.length<20||key.length>500))throw new Error('Invalid Notion integration key');
 if(!key&&!previous?.api_key&&!env.NOTION_API_KEY)throw new Error('Enter a Notion integration key');
 const parent=input.parentId?uuid(input.parentId):null;
 if(!input.databaseId&&!parent)throw new Error('Enter the parent Notion page ID');
 await env.CATALOG_DB.prepare(`INSERT INTO wa_crm_config(id,api_key,parent_id,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET api_key=excluded.api_key,parent_id=excluded.parent_id,updated_at=excluded.updated_at`)
 .bind(key?await seal(key,env.AGENT_ADMIN_KEY):previous?.api_key||await seal(env.NOTION_API_KEY,env.AGENT_ADMIN_KEY),parent,now()).run();
 const db=input.databaseId?await notion(env,'databases/'+uuid(input.databaseId),undefined,fetchFn):await notion(env,'databases',{parent:{type:'page_id',page_id:parent},title:[{text:{content:'Chandni Orders'}}],initial_data_source:{properties:notionSchema()}},fetchFn);
 const source=db.data_sources?.[0]?.id;
 if(!source)throw new Error('Notion database has no data source');
 const schema=await notion(env,'data_sources/'+source,undefined,fetchFn);
 for(const name of Object.keys(notionSchema()))if(!schema.properties?.[name])throw new Error('Database is missing property '+name);
 await env.CATALOG_DB.prepare('UPDATE wa_crm_config SET database_id=?,data_source_id=? WHERE id=1').bind(db.id,source).run();
 return {connected:true,databaseId:db.id};
}
function orderProperties(o,events){
 return {'Order ID':{title:[{text:{content:'CSM-'+o.order_id}}]},'Customer name':text(o.customer_name||o.party),'WhatsApp number':{phone_number:o.phone||null},'Firm / city':text([o.party,o.location].filter(Boolean).join(' / ')),'Products':text(o.products||o.notes),'Order date':date(new Date(o.created_at*1000).toISOString()),'Payment status':{select:{name:o.payment_status}},'Dispatch status':{select:{name:o.dispatch_status}},'Order status':{select:{name:o.status==='completed'?'Complete':o.order_status}},'Amount due':{number:o.amount_due??null},'Next action':date(o.next_action),'Last contact':date(o.last_contact),'Notes':text((o.notes||'')+'\nReview: '+o.confidence+'\n'+events.map(e=>e.outcome+': '+e.details).join('\n')),'Source message ID':text(o.start_message_id)};
}
export async function stageCrmPlaybooks(env,id){
 const o=await env.CATALOG_DB.prepare('SELECT c.*,o.party FROM wa_crm_orders c JOIN wa_orders o ON o.id=c.order_id WHERE c.order_id=?').bind(id).first();
 if(!o)return;
 await env.CATALOG_DB.prepare("UPDATE wa_crm_actions SET status='superseded' WHERE order_id=? AND status='pending' AND revision<>?").bind(id,o.revision).run();
 for(const action of playbook(o))await env.CATALOG_DB.prepare(`INSERT OR IGNORE INTO wa_crm_actions(id,order_id,kind,reason,preview,revision,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),id,action.kind,action.reason,action.preview,o.revision,now()+86400,now(),now()).run();
}
export async function syncCrm(env,fetchFn=fetch){
 await ensureCrmOrders(env);
 const config=await env.CATALOG_DB.prepare('SELECT data_source_id FROM wa_crm_config WHERE id=1').first();
 if(!config?.data_source_id)return {skipped:'Notion CRM not configured'};
 const {results}=await env.CATALOG_DB.prepare('SELECT c.*,o.party,o.location,o.notes,o.status,o.start_message_id,o.created_at FROM wa_crm_orders c JOIN wa_orders o ON o.id=c.order_id WHERE (c.revision>c.sync_revision OR c.synced_at<?) AND c.sync_lease<? ORDER BY c.synced_at,c.order_id LIMIT 5').bind(now()-300,now()).all();
 for(const o of results){
  const claim=await env.CATALOG_DB.prepare('UPDATE wa_crm_orders SET sync_lease=? WHERE order_id=? AND sync_lease<?').bind(now()+180,o.order_id,now()).run();if(!claim.meta.changes)continue;
  try{
   const {results:events}=await env.CATALOG_DB.prepare('SELECT id,outcome,details FROM wa_crm_events WHERE order_id=? ORDER BY created_at DESC LIMIT 10').bind(o.order_id).all();
   let pageId=o.notion_page_id;
   if(!pageId){const found=await notion(env,'data_sources/'+config.data_source_id+'/query',{filter:{property:'Order ID',title:{equals:'CSM-'+o.order_id}},page_size:2},fetchFn);if(found.results?.length>1)throw new Error('Duplicate Notion order reference; review required');pageId=found.results?.[0]?.id;}
   let properties=orderProperties(o,events);
   const state=await env.CATALOG_DB.prepare('SELECT properties_json FROM wa_crm_remote_state WHERE order_id=?').bind(o.order_id).first();
   if(pageId&&state){
    const fetched=await notion(env,'pages/'+pageId,undefined,fetchFn);
    const remote=fetched.properties?flatProperties(fetched.properties):JSON.parse(String(fetched.text||'').match(/<properties>\s*([\s\S]*?)\s*<\/properties>/)?.[1]||'{}');
    const before=JSON.parse(state.properties_json),desired=flatProperties(properties),patch={};
    const fields={'Customer name':'customer_name','WhatsApp number':'phone','Products':'products','Payment status':'payment_status','Dispatch status':'dispatch_status','Order status':'order_status','Amount due':'amount_due','date:Next action:start':'next_action'};
    for(const [name,field]of Object.entries(fields)){
      if(!(name in remote))continue;
      if(JSON.stringify(remote[name])===JSON.stringify(before[name]))continue;
      if(JSON.stringify(desired[name])!==JSON.stringify(before[name])&&JSON.stringify(desired[name])!==JSON.stringify(remote[name]))throw new Error('Conflicting Notion and admin edits to '+name+'; review required');
      patch[field]=remote[name];
    }
    if(Object.keys(patch).length){
      const clean=validateCrmPatch(patch),keys=Object.keys(clean);
      await env.CATALOG_DB.prepare('UPDATE wa_crm_orders SET '+keys.map(k=>k+'=?').join(',')+",confidence='needs_review',revision=revision+1 WHERE order_id=?").bind(...keys.map(k=>clean[k]),o.order_id).run();
      Object.assign(o,clean);o.revision++;o.confidence='needs_review';await stageCrmPlaybooks(env,o.order_id);
    }
    properties=orderProperties(o,events);
    // Keep human-authored Notion notes intact after initial capture. Delivery
    // events remain in the durable event log and are added below as new content.
    if('Notes' in remote){
      let notes=String(remote.Notes||'');
      for(const e of events)if(!notes.includes('[event:'+e.id+']'))notes+='\n[event:'+e.id+'] '+e.outcome+': '+e.details;
      properties.Notes={rich_text:Array.from({length:Math.ceil(notes.length/1900)},(_,i)=>({text:{content:notes.slice(i*1900,(i+1)*1900)}}))};
    }
   }
   const page=pageId?await notion(env,'pages/'+pageId,{properties},fetchFn):await notion(env,'pages',{parent:{type:'data_source_id',data_source_id:config.data_source_id},properties},fetchFn);
   await env.CATALOG_DB.prepare('UPDATE wa_crm_orders SET notion_page_id=?,sync_revision=?,synced_at=?,sync_error=NULL,sync_lease=0 WHERE order_id=?').bind(page.id,o.revision,now(),o.order_id).run();
   await env.CATALOG_DB.prepare('INSERT INTO wa_crm_remote_state(order_id,properties_json,updated_at) VALUES(?,?,?) ON CONFLICT(order_id) DO UPDATE SET properties_json=excluded.properties_json,updated_at=excluded.updated_at').bind(o.order_id,JSON.stringify(flatProperties(properties)),now()).run();
  }catch(error){await env.CATALOG_DB.prepare('UPDATE wa_crm_orders SET sync_error=?,sync_lease=? WHERE order_id=?').bind(String(error.message).slice(0,200),now()+300,o.order_id).run();}
 }
 return {processed:results.length};
}
export async function prepareCrmAction(env,id,sessionId,input){
 const a=await env.CATALOG_DB.prepare("SELECT a.*,c.phone,c.customer_name,c.amount_due,c.confidence,c.revision AS current_revision,o.created_at FROM wa_crm_actions a JOIN wa_crm_orders c ON c.order_id=a.order_id JOIN wa_orders o ON o.id=a.order_id WHERE a.id=?").bind(id).first();
 if(!a||a.status!=='pending'||a.expires_at<now()||a.revision!==a.current_revision)throw new Error('Action expired or order changed');
 if(a.kind==='checklist'){await env.CATALOG_DB.prepare("UPDATE wa_crm_actions SET status='completed',updated_at=? WHERE id=?").bind(now(),id).run();return {completed:true};}
 if(a.confidence!=='verified'||!a.phone)throw new Error('Review order details and enter the buyer phone first');
 const conversation=await env.CATALOG_DB.prepare('SELECT mode FROM wa_conversations WHERE wa_id=?').bind(a.phone.slice(1)).first();
 if(conversation?.mode==='optout')throw new Error('Recipient opted out');
 const recent=await env.CATALOG_DB.prepare("SELECT id FROM wa_crm_actions WHERE order_id=? AND kind=? AND status='prepared' AND updated_at>? LIMIT 1").bind(a.order_id,a.kind,now()-86400).first();
 if(recent)throw new Error('An action was already prepared in the last 24 hours');
 const claimed=await env.CATALOG_DB.prepare("UPDATE wa_crm_actions SET status='preparing',updated_at=? WHERE id=? AND status='pending'").bind(now(),id).run();if(!claimed.meta.changes)throw new Error('Action already prepared');
 try{
 let draft;
 if(a.kind==='payment'){
  if(!a.customer_name||!(a.amount_due>0))throw new Error('Customer name and positive amount due are required');
  draft=await prepareWhatsAppTemplate(env,sessionId,{to:a.phone,template_name:PAYMENT_TEMPLATE_NAME,language:'hi',body_parameters:[a.customer_name,new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata'}).format(new Date(a.created_at*1000)),String(a.amount_due)]});
 }else if(a.kind==='call')draft=await stageSarvamRest(env,sessionId,{to:a.phone,purpose:'payment follow-up',details:a.preview,startAt:input.startAt});
 else {
  if(!input.templateName||!input.trackingNumber||!input.carrier)throw new Error('Provide an approved tracking template, actual tracking number and carrier');
  draft=await prepareWhatsAppTemplate(env,sessionId,{to:a.phone,template_name:input.templateName,language:input.language||'hi',body_parameters:[a.customer_name||'',input.carrier,input.trackingNumber]});
 }
 await env.CATALOG_DB.prepare("UPDATE wa_crm_actions SET status='prepared',linked_draft_id=?,updated_at=? WHERE id=?").bind(draft.id,now(),id).run();
 return {prepared:true,draft};
 }catch(error){await env.CATALOG_DB.prepare("UPDATE wa_crm_actions SET status='unknown',updated_at=? WHERE id=?").bind(now(),id).run();throw error;}
}
export async function recordCrmEvent(env,event){
 const inserted=await env.CATALOG_DB.prepare('INSERT OR IGNORE INTO wa_crm_events(id,order_id,channel,outcome,details,created_at) VALUES(?,?,?,?,?,?)').bind(event.id,event.orderId,event.channel,event.outcome,String(event.details||'').slice(0,1000),now()).run();
 if(inserted.meta.changes)await env.CATALOG_DB.prepare('UPDATE wa_crm_orders SET last_contact=?,revision=revision+1 WHERE order_id=?').bind(new Date().toISOString(),event.orderId).run();
}
export async function createCrmViews(env){
 const c=await env.CATALOG_DB.prepare('SELECT * FROM wa_crm_config WHERE id=1').first();if(!c?.data_source_id||c.api_key!=='')return {skipped:true};
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());
 const views=[['Today','FILTER "Next action" = "'+day+'"'],['Payment pending','FILTER "Payment status" IN ("Pending", "Part paid")'],['Overdue','FILTER "Payment status" = "Overdue"'],['Ready to dispatch','FILTER "Payment status" = "Paid" AND "Dispatch status" IN ("Not ready", "Packed")'],['Needs review','FILTER "Payment status" = "Unknown" OR "WhatsApp number" IS EMPTY'],['Completed','FILTER "Order status" = "Complete"']];
 for(const [name,configure]of views){
  const previous=await env.CATALOG_DB.prepare('SELECT * FROM wa_crm_views WHERE name=?').bind(name).first();
  if(previous){if(name==='Today'&&previous.view_id&&previous.status!=='ready:'+day){await crmWorkspaceCall(env,'notion-update-view',{view_id:previous.view_id,configure});await env.CATALOG_DB.prepare('UPDATE wa_crm_views SET status=? WHERE name=?').bind('ready:'+day,name).run();}continue;}
  const claimed=await env.CATALOG_DB.prepare("INSERT OR IGNORE INTO wa_crm_views(name,status) VALUES(?,'creating')").bind(name).run();if(!claimed.meta.changes)continue;
  const result=decodeMcp(await crmWorkspaceCall(env,'notion-create-view',{data_source_id:c.data_source_id,database_id:c.database_id,name,type:'table',configure:configure+'; SORT BY "Next action" ASC; SHOW "Order ID", "Customer name", "WhatsApp number", "Payment status", "Dispatch status", "Amount due", "Next action"'}));
  const id=result.view_id||result.id||JSON.stringify(result).match(/view:\/\/([a-f0-9-]{36})/)?.[1];
  await env.CATALOG_DB.prepare('UPDATE wa_crm_views SET status=?,view_id=? WHERE name=?').bind('ready:'+day,id||null,name).run();
 }
 return {ready:true};
}
export async function crmMaintenance(env,sendWhatsApp){
 await ensureCrmOrders(env);
 const {results}=await env.CATALOG_DB.prepare("SELECT c.order_id FROM wa_crm_orders c WHERE c.order_status NOT IN ('Complete','Cancelled') ORDER BY c.order_id LIMIT 100").all();
 for(const o of results)await stageCrmPlaybooks(env,o.order_id);
 await syncCrm(env);
 await createCrmViews(env);
 const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',hourCycle:'h23'}).format(new Date());
 if(time!=='09')return;
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());
 const summary=await env.CATALOG_DB.prepare(`SELECT COUNT(*) AS total,SUM(payment_status='Overdue') AS overdue,SUM(confidence='needs_review') AS needs_review,SUM(next_action IS NULL) AS missing_next_action,SUM(date(next_action)<=date('now','+330 minutes')) AS due FROM wa_crm_orders WHERE order_status NOT IN ('Complete','Cancelled')`).first();
 await env.CATALOG_DB.prepare("INSERT OR IGNORE INTO wa_crm_digest(day,status,summary,created_at) VALUES(?,'ready',?,?)").bind(day,JSON.stringify(summary),now()).run();
 if(!sendWhatsApp)return;
 const owner=await env.CATALOG_DB.prepare('SELECT last_customer_at,mode FROM wa_conversations WHERE wa_id=?').bind('919537097267').first();
 if(!owner||owner.mode==='optout'||owner.last_customer_at<now()-23*3600)return;
 const claim=await env.CATALOG_DB.prepare("UPDATE wa_crm_digest SET status='sending' WHERE day=? AND status='ready'").bind(day).run();if(!claim.meta.changes)return;
 try{await sendWhatsApp(env,{messaging_product:'whatsapp',to:'919537097267',type:'text',text:{body:'Chandni CRM · '+day+'\nOpen orders: '+summary.total+'\nOverdue: '+(summary.overdue||0)+'\nNeeds review: '+(summary.needs_review||0)+'\nDue follow-ups: '+(summary.due||0)+'\nMissing next action: '+(summary.missing_next_action||0)+'\nReview orders and drafts in the admin chat.'}});await env.CATALOG_DB.prepare("UPDATE wa_crm_digest SET status='sent' WHERE day=?").bind(day).run();}catch{await env.CATALOG_DB.prepare("UPDATE wa_crm_digest SET status='unknown' WHERE day=?").bind(day).run();}
}
