const stamp=()=>Math.floor(Date.now()/1000);
export function validateScript(input){
 if(!['node','python'].includes(input.runtime))throw new Error('Choose Node.js or Python');
 const code=String(input.code||'');if(!code.trim()||new TextEncoder().encode(code).length>8192)throw new Error('Script must contain 1–8192 bytes');
 return {runtime:input.runtime,code};
}
export async function stageTerminal(env,sessionId,input){
 if(!/^[A-Za-z0-9_-]{8,80}$/.test(sessionId))throw new Error('Invalid operator session');
 if(!env.OPERATOR_TERMINAL)throw new Error('Cloud terminal is not deployed yet');
 const script=validateScript(input),id=crypto.randomUUID();
 await env.CATALOG_DB.prepare('INSERT INTO wa_terminal_runs(id,session_id,runtime,code,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(id,sessionId,script.runtime,script.code,stamp(),stamp()).run();
 return {id,...script,status:'pending'};
}
export async function confirmTerminal(env,id,sessionId){
 const row=await env.CATALOG_DB.prepare('SELECT * FROM wa_terminal_runs WHERE id=? AND session_id=?').bind(id,sessionId).first();
 if(!row||row.status!=='pending'||row.created_at<stamp()-600)throw new Error('Script expired or already submitted');
 const claim=await env.CATALOG_DB.prepare("UPDATE wa_terminal_runs SET status='running',updated_at=? WHERE id=? AND status='pending'").bind(stamp(),id).run();if(!claim.meta.changes)throw new Error('Script already submitted');
 try{
  const result=await env.OPERATOR_TERMINAL.run({id:row.id,runtime:row.runtime,code:row.code});
  await env.CATALOG_DB.prepare("UPDATE wa_terminal_runs SET status='completed',stdout=?,stderr=?,exit_code=?,updated_at=? WHERE id=?").bind(result.stdout,result.stderr,result.exitCode,stamp(),id).run();
  return result;
 }catch(error){await env.CATALOG_DB.prepare("UPDATE wa_terminal_runs SET status='unknown',stderr=?,updated_at=? WHERE id=?").bind('Execution status uncertain; review before rerunning. '+String(error.message).slice(0,200),stamp(),id).run();throw error;}
}
