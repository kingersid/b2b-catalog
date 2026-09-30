import { WorkerEntrypoint } from 'cloudflare:workers';
import { Sandbox, getSandbox } from '@cloudflare/sandbox';
import { validateScript } from '../src/terminal.js';

export class OwnerSandbox extends Sandbox { enableInternet=false; }

// This supervisor bounds output while it is read, terminates the whole process
// group on timeout/overflow, and never receives Worker bindings or credentials.
const SUPERVISOR=`import base64,json,os,selectors,signal,subprocess,sys,time
p=json.loads(base64.b64decode(sys.argv[1]))
cmd=['node','-e',p['code']] if p['runtime']=='node' else ['python3','-c',p['code']]
os.makedirs('/workspace',exist_ok=True)
c=subprocess.Popen(cmd,cwd='/workspace',env={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':'/workspace'},stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
s=selectors.DefaultSelector()
s.register(c.stdout,selectors.EVENT_READ,'stdout');s.register(c.stderr,selectors.EVENT_READ,'stderr')
out={'stdout':bytearray(),'stderr':bytearray()};deadline=time.monotonic()+20;total=0;limited=False
try:
 while s.get_map():
  if time.monotonic()>deadline: limited=True;break
  for k,_ in s.select(0.1):
   chunk=os.read(k.fileobj.fileno(),4096)
   if not chunk:s.unregister(k.fileobj);continue
   remaining=max(0,16384-total);out[k.data].extend(chunk[:remaining]);total+=len(chunk)
   if total>16384:limited=True;break
  if limited:break
finally:
 try:os.killpg(c.pid,signal.SIGKILL)
 except ProcessLookupError:pass
 s.close()
c.wait()
r={k:v.decode('utf-8','replace') for k,v in out.items()};r['exitCode']=c.returncode;r['limited']=limited
if limited:r['stderr']+='\\nStopped at the 20-second or 16 KB output limit.'
print(json.dumps(r))`;

export default class TerminalService extends WorkerEntrypoint {
 async fetch(){return new Response('Not found',{status:404});}
 async run(input){
  if(!/^[a-f0-9-]{36}$/.test(input.id||''))throw new Error('Invalid run');
  const script=validateScript(input);
  const sandbox=getSandbox(this.env.Sandbox,'owner-919537097267',{sleepAfter:'2m'});
  const encoded=Buffer.from(JSON.stringify(script)).toString('base64');
  const supervisor=Buffer.from(SUPERVISOR).toString('base64');
  const command="python3 -c \"import base64;exec(base64.b64decode('"+supervisor+"'))\" "+encoded;
  try{
   const result=await sandbox.exec(command,{timeout:30000});
   if(!result.success)throw new Error('Sandbox supervisor failed: '+String(result.stderr).slice(0,200));
   return JSON.parse(result.stdout);
  }finally{await sandbox.destroy();}
 }
}
