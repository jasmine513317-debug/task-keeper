(() => {
  const metaKey='task-keeper-cloud-v1';let meta={base:null,userId:'',revision:0};
  try{meta=JSON.parse(localStorage.getItem(metaKey))||meta;}catch{}
  let busy=false,timer,queued=false,lastError='';
  const status={label:'正在连接云端',mode:'connecting',user:'',lastSync:''};window.TaskCloud=status;
  function paint(){const el=document.querySelector('.local');if(el){el.innerHTML='<i></i><span></span>';el.querySelector('span').textContent=status.label;el.dataset.mode=status.mode;el.title=lastError||status.lastSync||status.label;}const detail=document.querySelector('#cloud-detail');if(detail){detail.textContent=status.user?`${status.user} · ${status.label}${status.lastSync?' · '+new Date(status.lastSync).toLocaleTimeString('zh-CN'):''}`:status.label;}}
  function mark(mode,label,error=''){status.mode=mode;status.label=label;lastError=error;paint();}
  const request=(url,options={})=>fetch(url,{...options,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(20000)});
  window.scheduleCloudSync=()=>{queued=true;mark('pending','本机已保存 · 待同步');clearTimeout(timer);timer=setTimeout(sync,900);};
  async function sync(){
    if(busy){queued=true;return;}if(storageFault)return;if(!navigator.onLine){mark('offline','离线 · 本机已保存');return;}
    busy=true;queued=false;mark('syncing','正在同步');
    try{
      const response=await request('/api/sync');
      if(response.status===401){mark('login','登录后同步');return;}
      if(!response.ok)throw Error('云端暂不可用，数据仍在本机');
      const remote=await response.json();if(!remote.user?.id)throw Error('同步服务返回无效身份');
      if(meta.userId&&meta.userId!==remote.user.id){mark('account','账号已变化 · 已暂停同步','请先导出本机数据，再切回原账号，防止数据传入错误账号。');return;}
      meta.userId=remote.user.id;status.user=remote.user.name||'我的账号';
      const merged=TaskSyncCore.merge(meta.base,state,remote.state);const changed=!TaskSyncCore.same(state,merged.state);
      if(changed){localStorage.setItem(KEY,JSON.stringify(merged.state));state=merged.state;if(!document.querySelector('#editor')?.open)render();}
      if(merged.conflicts.length)toast(`有 ${merged.conflicts.length} 项同时修改，已保留待核对副本`);
      const snapshot=structuredClone(state);
      if(!TaskSyncCore.same(snapshot,remote.state)){
        const result=await request('/api/sync',{method:'PUT',headers:{'Content-Type':'application/json','X-Task-Keeper':'sync-v1'},body:JSON.stringify({revision:remote.revision,state:snapshot})});
        if(result.status===409){meta.base=remote.state;queued=true;mark('pending','检测到新修改 · 正在重试');return;}
        if(!result.ok)throw Error('同步未完成，数据仍在本机');
        const saved=await result.json();meta.revision=saved.revision;meta.base=snapshot;
      }else{meta.revision=remote.revision;meta.base=snapshot;}
      try{localStorage.setItem(metaKey,JSON.stringify(meta));}catch{}
      status.lastSync=new Date().toISOString();mark('synced','已同步');
      if(!TaskSyncCore.same(state,snapshot))queued=true;
    }catch(e){mark('offline','待同步 · 本机已保存',e.message||'网络不可用');}
    finally{busy=false;if(queued){clearTimeout(timer);timer=setTimeout(sync,1500);}}
  }
  window.syncTaskCloud=sync;window.paintTaskCloud=paint;
  window.addEventListener('online',sync);window.addEventListener('offline',()=>mark('offline','离线 · 本机已保存'));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')sync();});
  setInterval(()=>{if(document.visibilityState==='visible')sync();},60000);
  sync();
})();
