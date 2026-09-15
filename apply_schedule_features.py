from pathlib import Path
p=Path('raspisanie-admin.html')
s=p.read_text(encoding='utf-8')
# photo persistence fix
s=s.replace('''  const trash=(TRASH||[]).slice(0,200);\n  let raw=JSON.stringify({updated:new Date().toISOString(),events,trash});\n  if(raw.length>90000){\n    raw=JSON.stringify({\n      updated:new Date().toISOString(),\n      events:events.map(ev=>Object.assign({},ev,{photo:""})),\n      trash:trash.map(ev=>Object.assign({},ev,{photo:""}))\n    });\n  }\n  return raw;''','''  const trash=(TRASH||[]).slice(0,200).map(ev=>Object.assign({},ev,{photo:""}));\n  return JSON.stringify({updated:new Date().toISOString(),events,trash});''')
s=s.replace('let EVENTS=[], TRASH=[], USER="", PHOTO="", ME=null;','let EVENTS=[], TRASH=[], USER="", PHOTO="", ME=null, EDIT_ID="";')
anchor='function setStatus(t){document.getElementById("status").textContent=t}'
helpers=r'''function audit(ev,action,details){const h=Array.isArray(ev.history)?ev.history.slice():[];h.push({at:new Date().toISOString(),by:USER||((ME&&ME.login)||""),action,details:details||""});ev.history=h.slice(-30)}
function hmMin(v){const a=String(v||"00:00").split(":");return Number(a[0])*60+Number(a[1])}
function findConflict(ev,ignore){const a0=hmMin(ev.gather||ev.start),a1=hmMin(ev.start||ev.gather)+(Number(ev.duration)||45);return EVENTS.find(x=>x.id!==ignore&&!x.done&&!x.cancelled&&x.date===ev.date&&String(x.place||"").trim().toLowerCase()===String(ev.place||"").trim().toLowerCase()&&a0<hmMin(x.start||x.gather)+(Number(x.duration)||45)&&a1>hmMin(x.gather||x.start))}
async function dsNotice(text){try{const h=dsHook();if(h)await fetch(h,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({content:text,allowed_mentions:{parse:[]}})})}catch(e){}}
async function refreshDiscord(ev,label){try{if(ev.dsId)await delDiscord(ev.dsId);ev.dsId="";await pingDiscord(ev);if(label)await dsNotice(label)}catch(e){}}
function editEvent(id){const ev=EVENTS.find(x=>x.id===id);if(!ev)return;EDIT_ID=id;document.querySelector('[data-view="create"]').click();document.getElementById("type").value=ev.type||"lecture";document.getElementById("titlePick").value="__custom__";document.getElementById("title").hidden=false;document.getElementById("title").value=ev.title||"";document.getElementById("place").value="__custom__";document.getElementById("placeCustom").hidden=false;document.getElementById("placeCustom").value=ev.place||"";document.getElementById("date").value=ev.date||"";document.getElementById("gather").value=ev.gather||"";document.getElementById("start").value=ev.start||"";document.getElementById("durationPick").value="__custom__";document.getElementById("durationCustom").hidden=false;document.getElementById("durationCustom").value=ev.duration||45;document.getElementById("note").value=ev.note||"";PHOTO=ev.photo||"";const pr=document.getElementById("prev");pr.src=PHOTO;pr.hidden=!PHOTO;document.querySelector('#f button[type="submit"]').textContent="Сохранить изменения";setStatus("Редактирование занятия")}
'''
s=s.replace(anchor,anchor+'\n'+helpers)
s=s.replace('${ev.note?`<div class="note">${ev.note}</div>`:""}', '${ev.cancelled?`<div class="note"><b>ОТМЕНЕНО:</b> ${ev.cancelReason||"без причины"}</div>`:""}\n      ${ev.note?`<div class="note">${ev.note}</div>`:""}\n      ${ev.history&&ev.history.length?`<p class="meta">История: ${ev.history[ev.history.length-1].action} · ${ev.history[ev.history.length-1].by||"—"}</p>`:""}')
s=s.replace('${ev.done?"":`<button class="ghost" data-done="${ev.id}">Лекция прошла</button>`}', '${ev.done||ev.cancelled?"":`<button class="ghost" data-edit="${ev.id}">Изменить</button><button class="ghost" data-move="${ev.id}">Перенести</button><button class="danger" data-cancel="${ev.id}">Отменить</button><button class="ghost" data-done="${ev.id}">Лекция прошла</button>`}')
needle='''  box.querySelectorAll("button[data-done]").forEach(b=>{\n    b.onclick=()=>finishLecture(b.dataset.done);\n  });'''
actions=r'''  box.querySelectorAll("button[data-edit]").forEach(b=>b.onclick=()=>editEvent(b.dataset.edit));
  box.querySelectorAll("button[data-cancel]").forEach(b=>b.onclick=async()=>{const ev=EVENTS.find(x=>x.id===b.dataset.cancel);if(!ev)return;const reason=prompt("Причина отмены:","");if(reason===null)return;ev.cancelled=true;ev.cancelReason=reason.trim();audit(ev,"Отмена",ev.cancelReason);save();render();if(ev.dsId)await delDiscord(ev.dsId);await dsNotice("**Занятие отменено · "+(ev.title||"УЦ")+"**\nДата: "+ev.date+" · "+(ev.start||ev.gather)+"\nПричина: "+(ev.cancelReason||"не указана"));publish().catch(()=>{})});
  box.querySelectorAll("button[data-move]").forEach(b=>b.onclick=async()=>{const ev=EVENTS.find(x=>x.id===b.dataset.move);if(!ev)return;const d=prompt("Новая дата ГГГГ-ММ-ДД",ev.date||"");if(!d)return;const g=prompt("Новое время сбора ЧЧ:ММ",ev.gather||"");if(!g)return;const st=prompt("Новое время начала ЧЧ:ММ",ev.start||"");if(!st)return;const test=Object.assign({},ev,{date:d,gather:g,start:st});const c=findConflict(test,ev.id);if(c){alert("Конфликт: "+c.title+" уже занимает "+c.place+" в это время.");return}const old=ev.date+" "+ev.start;ev.date=d;ev.gather=g;ev.start=st;audit(ev,"Перенос",old+" → "+d+" "+st);save();render();await refreshDiscord(ev,"Занятие перенесено: **"+(ev.title||"УЦ")+"**");publish().catch(()=>{})});
'''+needle
s=s.replace(needle,actions)
marker='''    photo:PHOTO||""\n  };\n  PENDING.push(ev);\n  EVENTS.push(ev);'''
replacement=r'''    photo:PHOTO||""
  };
  const clash=findConflict(ev,EDIT_ID);if(clash){setStatus("Конфликт: "+clash.title+" уже занимает "+clash.place+" в это время.");return}
  if(EDIT_ID){const old=EVENTS.find(x=>x.id===EDIT_ID);if(!old)return;ev.id=old.id;ev.dsId=old.dsId||"";ev.history=old.history||[];audit(ev,"Редактирование","Изменены данные занятия");EVENTS=EVENTS.map(x=>x.id===EDIT_ID?ev:x);EDIT_ID="";save();render();document.querySelector('#f button[type="submit"]').textContent="Добавить";PHOTO="";document.getElementById("prev").hidden=true;setStatus("Сохраняю изменения...");await refreshDiscord(ev,"Занятие изменено: **"+(ev.title||"УЦ")+"**");try{await publish();setStatus("Изменения сохранены.")}catch(err){setStatus("GitHub: "+err.message)}return}
  audit(ev,"Создание","Занятие создано");
  PENDING.push(ev);
  EVENTS.push(ev);'''
s=s.replace(marker,replacement)
p.write_text(s,encoding='utf-8')
print('features applied')