import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';

export const dynamic = 'force-dynamic';
const LIMIT = 8 * 1024 * 1024;
const json = (body: unknown, status=200) => Response.json(body,{status,headers:{'Cache-Control':'no-store, private','Vary':'Cookie'}});
async function readBounded(request: Request) {
  if (Number(request.headers.get('content-length')||0)>LIMIT) throw new Error('too_large');
  const reader=request.body?.getReader(); if(!reader)throw new Error('invalid');
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>LIMIT){await reader.cancel();throw new Error('too_large');}chunks.push(value);}
  const all=new Uint8Array(size);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.byteLength;}
  return JSON.parse(new TextDecoder().decode(all));
}
function validState(s: any) {
  if(!s||typeof s!=='object'||!Array.isArray(s.tasks)||s.tasks.length>10000||!Array.isArray(s.sources)||s.sources.length>300||!s.profile||typeof s.profile!=='object')return false;
  const ids=new Set();for(const t of s.tasks){if(!t||typeof t.id!=='string'||!/^[-a-zA-Z0-9]{1,100}$/.test(t.id)||ids.has(t.id)||typeof t.title!=='string'||!t.title.trim()||t.title.length>1000||!['todo','pending','done','ignored','deleted'].includes(t.status))return false;ids.add(t.id);}
  return s.sources.every((s:unknown)=>typeof s==='string'&&s.length<=80);
}
async function current(userId:string){return await env.DB!.prepare('SELECT revision, payload, updated_at FROM task_snapshots WHERE user_id = ?').bind(userId).first<{revision:number,payload:string,updated_at:string}>();}
export async function GET(){
  const user=await getChatGPTUser();if(!user)return json({error:'login_required'},401);
  if(!env.DB)return json({error:'storage_unavailable'},503);
  try{const row=await current(user.userId);return json({user:{id:user.userId,name:user.displayName},revision:row?.revision||0,state:row?JSON.parse(row.payload):null,updatedAt:row?.updated_at||null});}catch{return json({error:'storage_unavailable'},503);}
}
export async function PUT(request:Request){
  const user=await getChatGPTUser();if(!user)return json({error:'login_required'},401);
  if(!env.DB)return json({error:'storage_unavailable'},503);
  if(request.headers.get('x-task-keeper')!=='sync-v1'||!request.headers.get('content-type')?.startsWith('application/json')||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'invalid_request'},403);
  let body;try{body=await readBounded(request);}catch(e){return json({error:e instanceof Error&&e.message==='too_large'?'payload_too_large':'invalid_json'},400);}
  if(!body||!Number.isSafeInteger(body.revision)||body.revision<0||!validState(body.state))return json({error:'invalid_state'},400);
  const payload=JSON.stringify(body.state),updatedAt=new Date().toISOString();
  try{
    const result=await env.DB.prepare('INSERT INTO task_snapshots (user_id, revision, payload, updated_at) SELECT ?, 1, ?, ? WHERE ? = 0 OR EXISTS (SELECT 1 FROM task_snapshots WHERE user_id = ? AND revision = ?) ON CONFLICT(user_id) DO UPDATE SET revision = task_snapshots.revision + 1, payload = excluded.payload, updated_at = excluded.updated_at WHERE task_snapshots.revision = ?').bind(user.userId,payload,updatedAt,body.revision,user.userId,body.revision,body.revision).run();
    if(!result.meta.changes){const row=await current(user.userId);return json({error:'revision_conflict',revision:row?.revision||0,state:row?JSON.parse(row.payload):null},409);}
    return json({revision:body.revision+1,updatedAt});
  }catch{return json({error:'storage_unavailable'},503);}
}
