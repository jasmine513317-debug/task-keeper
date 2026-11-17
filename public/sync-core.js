(function(root){
 const C=root.StudyCore;
 const canonical=value=>JSON.stringify(value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])):Array.isArray(value)?value.map(x=>JSON.parse(canonical(x))):value??null);
 const same=(a,b)=>canonical(a)===canonical(b);
 const empty=()=>C.normalizeState({tasks:[],sources:[],profile:{}});
 function merge(base,local,remote){base=base?C.normalizeState(base):empty();local=C.normalizeState(local);remote=remote?C.normalizeState(remote):empty();const result=structuredClone(remote),conflicts=[];
   const maps=[base,local,remote].map(s=>new Map(s.tasks.map(t=>[t.id,t])));
   const purged=new Set([...(local.purged||[]),...(remote.purged||[])]);result.tasks=[];
   for(const id of new Set([...maps[1].keys(),...maps[2].keys()])){
     const b=maps[0].get(id),l=maps[1].get(id),r=maps[2].get(id);
     if(purged.has(id))continue;
     if(!l){if(r)result.tasks.push(r);continue;}if(!r){if(!b||!same(l,b))result.tasks.push(l);continue;}
     if(same(l,r)||same(l,b)){result.tasks.push(r);continue;}if(same(r,b)){result.tasks.push(l);continue;}
     // Preserve both divergent edits. Never silently reopen a completed task or drop local work.
     result.tasks.push(r);const copy=structuredClone(l);copy.id=C.id();copy.title=l.title+'（待核对副本）';copy.status='pending';copy.completedAt='';copy.warning='同一事项在不同设备上同时修改。此副本保留本机版本，请与云端版本核对。';copy.nextOccurrenceId='';copy.repeat='none';copy.updatedAt=new Date().toISOString();copy.history.push({action:'保留同步冲突副本',at:copy.updatedAt,detail:'原事项 ID：'+id});result.tasks.push(copy);conflicts.push(id);
   }
   result.purged=[...purged];
   const removed=new Set(base.sources.filter(x=>!local.sources.includes(x)||!remote.sources.includes(x)));result.sources=[...new Set([...remote.sources.filter(x=>!removed.has(x)),...local.sources.filter(x=>!removed.has(x))])];
   for(const k of ['name','className','group','courses'])result.profile[k]=!same(local.profile[k],base.profile[k])?local.profile[k]:remote.profile[k];
   for(const k of Object.keys(local.settings))result.settings[k]=!same(local.settings[k],base.settings[k])?local.settings[k]:remote.settings[k];
   const imports=new Map([...remote.imports,...local.imports].map(x=>[x.source+'|'+x.at,x]));result.imports=[...imports.values()].sort((a,b)=>a.at.localeCompare(b.at)).slice(-1000);
   result.lastBackupAt=[local.lastBackupAt,remote.lastBackupAt].sort().at(-1);result.onboarded=local.onboarded||remote.onboarded;return {state:result,conflicts};
 }
 function nextOccurrence(task,today=C.localDate()){
   if(task.repeat==='none'||!task.repeat)return null;
   const anchor=task.repeatAnchor||Number((task.due||task.plannedDate||today).slice(8,10));let d=new Date((task.due||task.plannedDate||today).slice(0,10)+'T12:00:00');
   const advance=()=>{if(task.repeat==='monthly'){d.setDate(1);d.setMonth(d.getMonth()+1);const end=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();d.setDate(Math.min(anchor,end));}else d.setDate(d.getDate()+(task.repeat==='weekly'?7:1));};
   advance();let guard=0;while(C.localDate(d)<=today&&guard++<3660)advance();
   const t=structuredClone(task);t.id=C.id();t.status='todo';t.completedAt='';t.deletedAt='';t.nextOccurrenceId='';t.repeatAnchor=anchor;t.seriesId=task.seriesId||task.id;t.createdAt=t.updatedAt=new Date().toISOString();t.history=[{action:'重复任务自动生成',at:t.createdAt,detail:'来自已完成事项：'+task.title}];t.checklist=t.checklist.map(x=>({...x,id:C.id(),done:false}));if(task.due)t.due=C.localDate(d)+task.due.slice(10);t.plannedDate=C.localDate(d);return t;
 }
 root.TaskSyncCore={merge,same,nextOccurrence};if(typeof module!=='undefined')module.exports=root.TaskSyncCore;
})(typeof window==='undefined'?globalThis:window);

