(function () {
  const base = String(window.UC_API_URL || "").replace(/\/+$/, "");
  const key = "uc_secure_session";
  function token() { return sessionStorage.getItem(key) || ""; }
  function setToken(value) { if (value) sessionStorage.setItem(key, value); else sessionStorage.removeItem(key); }
  async function request(path, options) {
    if (!base) throw new Error("Защищённый сервер ещё не настроен");
    const opts = Object.assign({}, options || {}); const headers = new Headers(opts.headers || {});
    if (token()) headers.set("Authorization", "Bearer " + token());
    if (opts.body && typeof opts.body !== "string") { headers.set("Content-Type", "application/json"); opts.body = JSON.stringify(opts.body); }
    opts.headers = headers; opts.cache = "no-store";
    const response = await fetch(base + path, opts); let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) { const error = new Error(data.error || ("Сервер " + response.status)); error.status = response.status; error.data = data; throw error; }
    return data;
  }
  window.UCAPI = {
    ready: !!base, base, token, setToken, request,
    async login(login, password) { const data = await request("/api/auth/login", { method:"POST", body:{login,password} }); setToken(data.token); return data; },
    async logout() { try { await request("/api/auth/logout", {method:"POST"}); } finally { setToken(""); } },
    me: () => request("/api/me"), changePassword: password => request("/api/auth/password", {method:"POST",body:{password}}),
    publicSchedule: () => request("/api/schedule"),
    schedule: () => request("/api/events"),
    createEvent: value => request("/api/events", {method:"POST", body:value}),
    updateEvent: (id,value) => request("/api/events/"+encodeURIComponent(id), {method:"PATCH", body:value}),
    cancelEvent: (id,reason) => request("/api/events/"+encodeURIComponent(id)+"/cancel", {method:"POST", body:{reason}}),
    finishEvent: id => request("/api/events/"+encodeURIComponent(id)+"/finish", {method:"POST"}),
    deleteEvent: id => request("/api/events/"+encodeURIComponent(id), {method:"DELETE"}),
    restoreEvent: id => request("/api/events/"+encodeURIComponent(id)+"/restore", {method:"POST"}),
    users: () => request("/api/users"),
    createUser: value => request("/api/users", {method:"POST",body:value}),
    updateUser: (login,value) => request("/api/users/"+encodeURIComponent(login), {method:"PATCH",body:value}),
    deleteUser: login => request("/api/users/"+encodeURIComponent(login), {method:"DELETE"}),
    audit: () => request("/api/audit"), backups: () => request("/api/backups"), dashboard: () => request("/api/dashboard"),
    restoreBackup: id => request("/api/backups/"+encodeURIComponent(id)+"/restore", {method:"POST"}),
    publicPromotions: () => request("/api/promotions"),
    createPromotion: value => request("/api/promotions", {method:"POST",body:value}),
    updatePromotion: (id,value) => request("/api/promotions/"+encodeURIComponent(id), {method:"PATCH",body:value})
  };
  window.ucRequirePasswordChange = function(user){
    if(!user||!user.forcePasswordChange)return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const shade=document.createElement("div");shade.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:99999;display:grid;place-items:center;padding:16px";
      shade.innerHTML='<form style="width:min(420px,100%);background:#171a1d;color:#e8eaec;border:1px solid #39414a;border-radius:12px;padding:18px;font:14px system-ui"><h2 style="margin-top:0">Смените временный пароль</h2><p style="color:#aab1b8">Старые хеши находились в публичном файле. Для безопасности задайте новый пароль.</p><input name="a" type="password" autocomplete="new-password" placeholder="Новый пароль — минимум 10 символов" style="width:100%;padding:10px;margin:6px 0;background:#101214;color:#fff;border:1px solid #39414a;border-radius:8px"><input name="b" type="password" autocomplete="new-password" placeholder="Повторите пароль" style="width:100%;padding:10px;margin:6px 0;background:#101214;color:#fff;border:1px solid #39414a;border-radius:8px"><button style="margin-top:10px;padding:10px 14px;border:0;border-radius:8px;background:#7a1f2b;color:#fff;font-weight:700">Сохранить</button><p data-error style="color:#ff9d9d"></p></form>';
      document.body.appendChild(shade);const form=shade.querySelector("form"),err=shade.querySelector("[data-error]");
      form.onsubmit=async e=>{e.preventDefault();const a=form.elements.a.value,b=form.elements.b.value;if(a.length<10){err.textContent="Минимум 10 символов";return}if(a!==b){err.textContent="Пароли не совпадают";return}try{await UCAPI.changePassword(a);shade.remove();resolve()}catch(x){err.textContent=x.message}};
    });
  };
})();
