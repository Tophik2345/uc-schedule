(function () {
  if (!window.UCAPI) return;
  function apiUser(u) { return { login:u.login, first:u.first||"", last:u.last||"", role:u.role, blocked:!!u.blocked, canDelete:u.role==="owner"||u.role==="admin" }; }
  gh = async function () { throw new Error("Прямой доступ к GitHub отключён"); };
  dsHook = function () { return ""; }; dsReportHook = function () { return ""; };
  pingDiscord = async function () {}; delDiscord = async function () {}; dsNotice = async function () {}; sendHook = async function () {};
  pullUsers = async function () { const data=await UCAPI.users(); const list=data.users.map(apiUser); saveUsers(list); return list; };
  pushUsers = async function () { throw new Error("Пользователей добавляет owner или admin"); };
  pullRemote = async function () { const data=await UCAPI.schedule(); EVENTS=data.events||[]; TRASH=data.trash||[]; save(); return data; };
  publish = async function () {
    const data=await UCAPI.schedule(), remote=new Map((data.events||[]).map(x=>[String(x.id),x]));
    for(const ev of EVENTS){ if(!ev||!ev.id) continue; if(remote.has(String(ev.id))) await UCAPI.updateEvent(ev.id,ev); else await UCAPI.createEvent(ev); }
    if(ME&&ME.canDelete){ for(const ev of TRASH||[]){ if(ev&&ev.id&&remote.has(String(ev.id))) await UCAPI.deleteEvent(ev.id); } }
    await pullRemote();
  };
  const enter=document.getElementById("enter");
  enter.onclick=async function(){
    const login=document.getElementById("login").value.trim(), pass=document.getElementById("pass").value;
    if(!UCAPI.ready){alert("Защищённый сервер ещё развёртывается. Попробуйте позже.");return;}
    try{const data=await UCAPI.login(login,pass);await ucRequirePasswordChange(data.user);ME=apiUser(data.user);USER=((ME.last+" "+ME.first).trim()||ME.login);localStorage.setItem("uc_login",login);await openApp();}
    catch(e){alert(e.message);}
  };
  document.getElementById("reg").onclick=()=>alert("Самостоятельная регистрация отключена. Аккаунт создаёт owner или admin.");
  document.getElementById("out").onclick=async()=>{await UCAPI.logout();location.reload();};
  localStorage.removeItem("uc_remember"); localStorage.removeItem("uc_user"); localStorage.removeItem("uc_until");
})();
