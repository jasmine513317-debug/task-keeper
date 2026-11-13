// Product additions: weekly planning, checklists, theme and foreground reminders.
let weekOffset=0;
function weekStrip(){const start=new Date(C.localDate()+'T12:00:00');start.setDate(start.getDate()-(start.getDay()+6)%7+weekOffset*7);const days=Array.from({length:7},(_,i)=>{const d=new Date(start);d.setDate(d.getDate()+i);const value=C.localDate(d),count=state.tasks.filter(t=>t.status==='todo'&&(t.plannedDate===value||t.due.slice(0,10)===value)).length;return `<button class="week-day ${filter==='day'&&selectedDate===value?'selected':''} ${value===C.localDate()?'is-today':''}" data-day="${value}" aria-label="${value}，${count} 项"><span>${['一','二','三','四','五','六','日'][i]}</span><b>${d.getDate()}</b><i class="${count?'has-tasks':''}" aria-hidden="true"></i></button>`;}).join('');return `<section class="week-planner" aria-label="一周计划"><div class="split"><h2>${start.getFullYear()} 年 ${start.getMonth()+1} 月</h2><div class="week-controls"><button data-week="-1" aria-label="上一周">‹</button><button data-week="0">本周</button><button data-week="1" aria-label="下一周">›</button></div></div><div class="week-days">${days}</div></section>`;}
function editorExtras(t,readonly){return `<div class="editor-section"><h3>安排与拆解</h3><div class="field-row"><label class="field">计划开始日<input type="date" name="plannedDate" value="${esc(t.plannedDate)}" ${readonly?'readonly':''}></label><label class="field">预计用时<select name="estimate" ${readonly?'disabled':''}>${[0,5,15,30,60,90,120].map(v=>`<option value="${v}" ${v===t.estimate?'selected':''}>${v?v+' 分钟':'不估算'}</option>`).join('')}</select></label></div><div class="field-row"><label class="field">重复<select aria-label="重复" name="repeat" ${readonly?'disabled':''}>${[['none','不重复'],['daily','每天'],['weekly','每周'],['monthly','每月']].map(([v,n])=>`<option value="${v}" ${t.repeat===v?'selected':''}>${n}</option>`).join('')}</select></label><label class="field">提前提醒<select name="remindMinutes" ${readonly?'disabled':''}>${[[0,'不提前'],[10,'10 分钟'],[30,'30 分钟'],[60,'1 小时'],[1440,'1 天']].map(([v,n])=>`<option value="${v}" ${t.remindMinutes===v?'selected':''}>${n}</option>`).join('')}</select></label></div><p class="muted small">重复事项在完成后生成下一次。网页提醒仅在页面打开时检查；关闭网页请使用日历提醒。</p><label class="field">拆成步骤（每行一步）<textarea name="checklistText" class="short-textarea" maxlength="12000" placeholder="阅读材料\n完成初稿\n检查并提交" ${readonly?'readonly':''}>${esc(t.checklist.map(x=>x.text).join('\n'))}</textarea></label></div>`;}
function taskSteps(t){if(!t.checklist.length)return '';const finished=t.checklist.filter(x=>x.done).length;return `<details class="task-steps"><summary>步骤 ${finished}/${t.checklist.length}<span class="step-track"><i style="width:${finished/t.checklist.length*100}%"></i></span></summary>${t.checklist.map(x=>`<label><input type="checkbox" data-step-task="${t.id}" data-step="${x.id}" ${x.done?'checked':''} ${t.status!=='todo'?'disabled':''}><span class="${x.done?'step-done':''}">${esc(x.text)}</span></label>`).join('')}</details>`;}
function settingsPanel(){return `<section class="card settings-panel"><h2>偏好与同步</h2><p class="muted small" id="cloud-detail">${esc(window.TaskCloud?.label||'正在连接云端')}</p><div class="actions"><button class="ghost" data-sync-now>立即同步</button><a class="button-link" href="/signin-with-chatgpt?return_to=%2Findex.html">登录账号</a></div><label class="field">外观<select aria-label="外观" id="theme-setting">${[['light','暖白'],['dark','深夜'],['system','跟随系统']].map(([v,n])=>`<option value="${v}" ${state.settings.theme===v?'selected':''}>${n}</option>`).join('')}</select></label><label class="field">默认打开<select id="default-view-setting"><option value="all" ${state.settings.defaultView==='all'?'selected':''}>全部待办</option><option value="today" ${state.settings.defaultView==='today'?'selected':''}>今天的安排</option></select></label><label class="toggle-setting"><input type="checkbox" id="reminders-setting" ${state.settings.reminders?'checked':''}>页面打开时显示到期提醒</label><p class="muted small">不会自动申请系统通知权限。页面关闭后不保证提醒，请导出到系统日历。</p><button class="ghost wide" data-copy-ics>复制待办日历内容</button></section>`;}
const originalRender=render;
render=function(){originalRender();if(page==='todo'){const summary=$('.summary');summary?.insertAdjacentHTML('afterend',weekStrip());$('#task-list')?.classList.add('compact-list');if(filter==='day')$('.section-head h2').textContent=selectedDate+' 的安排';}
 if(page==='import'){
  document.querySelector('.ocr-box')?.insertAdjacentHTML('beforebegin',`<div class="capture-tools"><button type="button" class="ghost" data-paste-message>粘贴剪贴板文字</button><label class="upload-control">导入文字文件<input type="file" id="message-file" accept="text/plain,text/markdown,.txt,.md"></label></div><p class="muted small">在微信、QQ 或学习通中复制通知，或保存截图后转入。文件支持 UTF-8 格式的 TXT / MD，最多 1 MB。请分别选择来源和原消息日期。</p>`);
 }
 if(page==='me'){const first=$('.grid>section:last-child');first?.insertAdjacentHTML('afterbegin',settingsPanel());window.paintTaskCloud?.();}
 enhanceTaskCards();
};
function enhanceTaskCards(){document.querySelectorAll('article[data-task]').forEach(el=>{const t=getTask(el.dataset.task);if(t&&['todo','done'].includes(t.status)){const actions=el.querySelector('.actions');if(!el.querySelector('.task-steps'))actions?.insertAdjacentHTML('beforebegin',taskSteps(t));if(t.plannedDate&&!el.querySelector('.plan-label'))el.querySelector('.meta')?.insertAdjacentHTML('beforeend',`<span class="plan-label">计划 ${esc(t.plannedDate.slice(5).replace('-','/'))}</span>`);if(t.repeat!=='none'&&!el.querySelector('.repeat-label'))el.querySelector('.meta')?.insertAdjacentHTML('beforeend',`<span class="repeat-label">${{daily:'每天',weekly:'每周',monthly:'每月'}[t.repeat]}</span>`);}});
};
const originalRenderList=renderList;renderList=function(){originalRenderList();enhanceTaskCards();};
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const d=b.dataset;if(d.day){selectedDate=d.day;filter='day';render();}if('week'in d){weekOffset=+d.week===0?0:weekOffset+Number(d.week);render();}if('copyIcs'in d){const tasks=state.tasks.filter(t=>t.status==='todo'&&t.due);if(!tasks.length)return toast('没有带期限的待办');openDialog('<h2>日历内容</h2><p class="muted">可下载 .ics 文件，或复制内容保存为 .ics 后导入日历。</p><label class="field">iCalendar 内容<textarea id="ics-copy" readonly></textarea></label><div class="actions"><button class="primary" data-export-calendar>下载日历文件</button><button class="ghost" data-close>关闭</button></div>');$('#ics-copy').value=C.calendar(tasks);}});
document.addEventListener('change',e=>{const el=e.target;if(el.dataset.step){const checked=el.checked;if(commit(s=>{const t=s.tasks.find(t=>t.id===el.dataset.stepTask);const step=t.checklist.find(x=>x.id===el.dataset.step);step.done=checked;log(t,checked?'完成步骤':'恢复步骤',step.text);})){const details=el.closest('details');const count=getTask(el.dataset.stepTask).checklist.filter(x=>x.done).length;details.querySelector('summary').innerHTML=`步骤 ${count}/${getTask(el.dataset.stepTask).checklist.length}<span class="step-track"><i style="width:${count/getTask(el.dataset.stepTask).checklist.length*100}%"></i></span>`;el.nextElementSibling.classList.toggle('step-done',checked);}}
 if(el.id==='theme-setting'){if(commit(s=>{s.settings.theme=el.value;}))document.documentElement.dataset.theme=el.value;}
 if(el.id==='default-view-setting')commit(s=>{s.settings.defaultView=el.value;});
 if(el.id==='reminders-setting'){commit(s=>{s.settings.reminders=el.checked;});toast(el.checked?'已开启页面内提醒':'已关闭页面内提醒');}
});
const reminderSeen=new Set();
function checkReminders(){if(!state.settings.reminders||document.visibilityState!=='visible')return;const time=Date.now();for(const t of state.tasks.filter(t=>t.status==='todo'&&t.due.includes('T'))){const due=C.dueTime(t.due),key=t.id+'|'+t.due;if(time>=due-t.remindMinutes*60000&&time<due+3600000&&!reminderSeen.has(key)){reminderSeen.add(key);toast((time>due?'已到期：':'即将到期：')+t.title);break;}}}
setInterval(checkReminders,30000);document.addEventListener('visibilitychange',checkReminders);
// A shared text URL can prefill capture without executing or navigating to that URL.
const params=new URLSearchParams(location.search),shared=[params.get('title'),params.get('text'),params.get('url')].filter(Boolean).join('\n');if(shared){draft.text=[draft.text,shared].filter(Boolean).join('\n\n').slice(0,30000);persistDraft();history.replaceState(null,'',location.pathname+'#import');page='import';}
render();

function appendCapturedText(text){
 if(!text.trim())return toast('未找到文字内容');
 const value=[draft.text,text].filter(Boolean).join('\n\n');
 if(value.length>30000)return toast('合并后超过 30000 字，请分批转入');
 draft.text=value;persistDraft();render();toast('已转入文字，请核对来源、日期和内容');
}
document.addEventListener('click',async e=>{
 if(!e.target.closest('[data-paste-message]'))return;
 try{if(!navigator.clipboard?.readText)throw Error();appendCapturedText(await navigator.clipboard.readText());}
 catch{toast('无法读取剪贴板，请长按消息输入框粘贴');document.querySelector('textarea[name="text"]')?.focus();}
});
document.addEventListener('change',async e=>{
 if(e.target.id!=='message-file')return;const file=e.target.files?.[0];if(!file)return;
 if(!/\.(txt|md)$/i.test(file.name)||file.size>1024*1024){toast('请选择 1 MB 以内的 TXT 或 MD 文件');e.target.value='';return;}
 try{const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());if(text.includes('\u0000'))throw Error();appendCapturedText(text.replace(/^\uFEFF/,''));}
 catch{toast('文件无法作为 UTF-8 文字读取，请复制文字或转为 UTF-8 后重试');}
 e.target.value='';
});

