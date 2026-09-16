const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const PASSWORD_ITERATIONS = 210000;
const LEGACY_SALT = "uc-fsb-schedule-2026";

export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") return cors(request, env, new Response(null, { status: 204 }));
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";
      if (path === "/api/health" && request.method === "GET") {
        return respond(request, env, { ok: true, service: "uc-schedule-api" });
      }
      if (path === "/api/bootstrap" && request.method === "POST") return bootstrap(request, env);
      if (path === "/api/auth/login" && request.method === "POST") return login(request, env);
      if (path === "/api/auth/logout" && request.method === "POST") return logout(request, env);
      if (path === "/api/schedule" && request.method === "GET") return publicSchedule(request, env);
      if (path === "/api/promotions" && request.method === "GET") return publicPromotions(request, env);

      const auth = await requireAuth(request, env);
      if (auth.error) return auth.error;
      if (path === "/api/auth/password" && request.method === "POST") return changeOwnPassword(request, env, auth);
      if (auth.user.force_password_change && path !== "/api/me") return respond(request, env, { error: "Сначала смените временный пароль", code: "PASSWORD_CHANGE_REQUIRED" }, 403);
      if (path === "/api/me" && request.method === "GET") {
        return respond(request, env, { user: safeUser(auth.user) });
      }
      if (path === "/api/events" && request.method === "POST") return createEvent(request, env, auth);
      if (path === "/api/events" && request.method === "GET") return privateSchedule(request, env, auth);
      if (path === "/api/promotions" && request.method === "POST") return createPromotion(request, env, auth);
      if (path === "/api/users" && request.method === "GET") return listUsers(request, env, auth);
      if (path === "/api/users" && request.method === "POST") return createUser(request, env, auth);
      if (path === "/api/audit" && request.method === "GET") return listAudit(request, env, auth);
      if (path === "/api/backups" && request.method === "GET") return listBackups(request, env, auth);
      if (path === "/api/dashboard" && request.method === "GET") return dashboard(request, env, auth);

      const eventMatch = path.match(/^\/api\/events\/([^/]+)(?:\/(restore|finish|cancel))?$/);
      if (eventMatch) {
        const id = decodeURIComponent(eventMatch[1]);
        const action = eventMatch[2] || "";
        if (request.method === "PATCH" && !action) return updateEvent(request, env, auth, id);
        if (request.method === "DELETE" && !action) return deleteEvent(request, env, auth, id);
        if (request.method === "POST" && action === "restore") return restoreEvent(request, env, auth, id);
        if (request.method === "POST" && action === "finish") return finishEvent(request, env, auth, id);
        if (request.method === "POST" && action === "cancel") return cancelEvent(request, env, auth, id);
      }
      const userMatch = path.match(/^\/api\/users\/([^/]+)$/);
      if (userMatch && request.method === "PATCH") return updateUser(request, env, auth, decodeURIComponent(userMatch[1]));
      if (userMatch && request.method === "DELETE") return deleteUser(request, env, auth, decodeURIComponent(userMatch[1]));
      const backupMatch = path.match(/^\/api\/backups\/(\d+)\/restore$/);
      if (backupMatch && request.method === "POST") return restoreBackup(request, env, auth, Number(backupMatch[1]));
      const promoMatch = path.match(/^\/api\/promotions\/([^/]+)$/);
      if (promoMatch && request.method === "PATCH") return updatePromotion(request, env, auth, decodeURIComponent(promoMatch[1]));

      return respond(request, env, { error: "Маршрут не найден" }, 404);
    } catch (error) {
      console.error(error);
      return respond(request, env, { error: "Внутренняя ошибка сервера" }, 500);
    }
  }
};

function cors(request, env, response) {
  const origin = request.headers.get("origin") || "";
  const allowed = String(env.ALLOWED_ORIGIN || "https://tophik2345.github.io").split(",").map(x => x.trim());
  const headers = new Headers(response.headers);
  if (allowed.includes(origin)) headers.set("access-control-allow-origin", origin);
  headers.set("vary", "Origin");
  headers.set("access-control-allow-headers", "authorization, content-type");
  headers.set("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  return new Response(response.body, { status: response.status, headers });
}

function respond(request, env, body, status = 200) {
  return cors(request, env, new Response(JSON.stringify(body), { status, headers: JSON_HEADERS }));
}

async function readJson(request, max = 2_500_000) {
  const raw = await request.text();
  if (raw.length > max) throw new Error("payload_too_large");
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new Error("invalid_json"); }
}

function now() { return new Date().toISOString(); }
function norm(value) { return String(value || "").trim().toLowerCase(); }
function cleanText(value, max = 4000) { return String(value ?? "").trim().slice(0, max); }
function roleAtLeast(user, roles) { return roles.includes(user.role); }
function safeUser(row) {
  return { login: row.login, first: row.first_name || "", last: row.last_name || "", role: row.role, blocked: !!row.blocked, forcePasswordChange: !!row.force_password_change };
}

function bytesToHex(bytes) { return [...bytes].map(b => b.toString(16).padStart(2, "0")).join(""); }
function bytesToB64(bytes) { return btoa(String.fromCharCode(...bytes)); }
function b64ToBytes(value) { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
async function sha256(value) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: b64ToBytes(salt), iterations: PASSWORD_ITERATIONS }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}
function randomToken(size = 32) { const b = new Uint8Array(size); crypto.getRandomValues(b); return bytesToB64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function constantEqual(a, b) {
  a = String(a || ""); b = String(b || "");
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i % Math.max(1, a.length)) || 0) ^ (b.charCodeAt(i % Math.max(1, b.length)) || 0);
  return diff === 0;
}

function ipOf(request) { return request.headers.get("cf-connecting-ip") || ""; }
async function audit(env, request, actor, action, targetType, targetId = "", details = "") {
  await env.DB.prepare("INSERT INTO audit_log(at,actor,action,target_type,target_id,details,ip) VALUES(?,?,?,?,?,?,?)")
    .bind(now(), actor || "system", action, targetType, cleanText(targetId, 200), cleanText(details, 2000), ipOf(request)).run();
}

async function snapshot(env, actor, reason) {
  const [users, events, deleted, promotions] = await Promise.all([
    env.DB.prepare("SELECT login,first_name,last_name,role,blocked,force_password_change,created_at,updated_at,last_seen_at FROM users").all(),
    env.DB.prepare("SELECT * FROM events").all(), env.DB.prepare("SELECT * FROM deleted_events").all(), env.DB.prepare("SELECT * FROM promotions").all()
  ]);
  const data = JSON.stringify({ users: users.results, events: events.results, deleted: deleted.results, promotions: promotions.results });
  await env.DB.prepare("INSERT INTO backups(at,actor,reason,snapshot) VALUES(?,?,?,?)").bind(now(), actor, reason, data).run();
  await env.DB.prepare("DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY id DESC LIMIT 50)").run();
}

async function requireAuth(request, env) {
  const raw = request.headers.get("authorization") || "";
  const token = raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
  if (!token) return { error: respond(request, env, { error: "Требуется вход" }, 401) };
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.login=s.login WHERE s.token_hash=? AND s.expires_at>?`).bind(tokenHash, now()).first();
  if (!row || row.blocked) return { error: respond(request, env, { error: "Сессия недействительна" }, 401) };
  return { user: row, tokenHash };
}

async function bootstrap(request, env) {
  const raw = request.headers.get("authorization") || "";
  const supplied = raw.startsWith("Bearer ") ? raw.slice(7) : "";
  if (!env.BOOTSTRAP_TOKEN || !constantEqual(supplied, env.BOOTSTRAP_TOKEN)) return respond(request, env, { error: "Доступ запрещён" }, 403);
  const done = await env.DB.prepare("SELECT value FROM app_meta WHERE key='bootstrapped'").first();
  if (done) return respond(request, env, { error: "Импорт уже выполнен" }, 409);
  const body = await readJson(request, 4_000_000);
  const usersDoc = body.users || {};
  const schedule = body.schedule || {};
  const promotions = body.promotions || {};
  const at = now();
  const batch = [];
  const ownerLogin = norm(body.ownerLogin || "owner");
  if (usersDoc.ownerHash) {
    batch.push(env.DB.prepare(`INSERT INTO users(login,first_name,last_name,role,legacy_hash,blocked,force_password_change,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)`)
      .bind(ownerLogin, "Владелец", "УЦ", "owner", usersDoc.ownerHash, 0, at, at));
  }
  for (const u of (usersDoc.users || [])) {
    const login = norm(u.login); if (!login || !u.hash) continue;
    const role = u.role === "owner" ? "owner" : (u.role === "admin" || u.canDelete ? "admin" : "instructor");
    batch.push(env.DB.prepare(`INSERT OR IGNORE INTO users(login,first_name,last_name,role,legacy_hash,blocked,force_password_change,created_at,updated_at,last_seen_at) VALUES(?,?,?,?,?,?,1,?,?,?)`)
      .bind(login, cleanText(u.first, 100), cleanText(u.last, 100), role, u.hash, u.blocked ? 1 : 0, u.created || at, at, u.lastSeen || null));
  }
  for (const ev of (schedule.events || [])) {
    const id = cleanText(ev.id || crypto.randomUUID(), 200);
    const owner = norm(ev.createdBy || ev.login || ownerLogin) || ownerLogin;
    batch.push(env.DB.prepare("INSERT OR REPLACE INTO events(id,payload,owner_login,cancelled,done,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
      .bind(id, JSON.stringify({ ...ev, id }), owner, ev.cancelled ? 1 : 0, ev.done ? 1 : 0, ev.createdAt || at, at));
  }
  for (const ev of (schedule.trash || [])) {
    const id = cleanText(ev.id || crypto.randomUUID(), 200);
    batch.push(env.DB.prepare("INSERT OR REPLACE INTO deleted_events(id,payload,owner_login,deleted_at,deleted_by) VALUES(?,?,?,?,?)")
      .bind(id, JSON.stringify({ ...ev, id }), norm(ev.createdBy || ownerLogin) || ownerLogin, ev.deletedAt || at, norm(ev.deletedBy || ownerLogin) || ownerLogin));
  }
  for (const item of (promotions.items || [])) {
    const id = cleanText(item.id || crypto.randomUUID(), 200);
    batch.push(env.DB.prepare("INSERT OR REPLACE INTO promotions(id,payload,owner_login,created_at,updated_at) VALUES(?,?,?,?,?)")
      .bind(id, JSON.stringify({ ...item, id }), norm(item.createdBy || item.author || ownerLogin) || ownerLogin, item.created || at, at));
  }
  batch.push(env.DB.prepare("INSERT INTO app_meta(key,value) VALUES('bootstrapped',?)").bind(at));
  batch.push(env.DB.prepare("INSERT OR IGNORE INTO discord_stats(id,last_checked_at) VALUES(1,?)").bind(at));
  await env.DB.batch(batch);
  await audit(env, request, "system", "bootstrap", "system", "", `users:${(usersDoc.users || []).length}, events:${(schedule.events || []).length}`);
  return respond(request, env, { ok: true });
}

async function login(request, env) {
  const body = await readJson(request, 20_000);
  const login = norm(body.login); const password = String(body.password || "");
  if (!login || !password) return respond(request, env, { error: "Введите логин и пароль" }, 400);
  const ip = ipOf(request);
  const key = await sha256(`${login}|${ip}`);
  const attempts = await env.DB.prepare("SELECT * FROM login_attempts WHERE key=?").bind(key).first();
  if (attempts?.locked_until && attempts.locked_until > now()) {
    await audit(env, request, login, "login_blocked", "auth", login);
    return respond(request, env, { error: "Слишком много попыток. Повторите позже.", lockedUntil: attempts.locked_until }, 429);
  }
  const user = await env.DB.prepare("SELECT * FROM users WHERE login=?").bind(login).first();
  let valid = false;
  if (user && !user.blocked) {
    if (user.password_hash && user.password_salt) valid = constantEqual(await passwordHash(password, user.password_salt), user.password_hash);
    else if (user.legacy_hash) valid = constantEqual(await sha256(`${LEGACY_SALT}|${password}`), user.legacy_hash);
  }
  if (!valid) {
    const failures = Number(attempts?.failures || 0) + 1;
    const lockedUntil = failures >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
    await env.DB.prepare(`INSERT INTO login_attempts(key,failures,locked_until,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET failures=excluded.failures,locked_until=excluded.locked_until,updated_at=excluded.updated_at`)
      .bind(key, failures >= 5 ? 0 : failures, lockedUntil, now()).run();
    await audit(env, request, login, lockedUntil ? "login_lock" : "login_failed", "auth", login);
    return respond(request, env, { error: lockedUntil ? "Вход временно заблокирован на 15 минут" : `Неверный логин или пароль. Осталось попыток: ${Math.max(0, 5 - failures)}`, lockedUntil }, lockedUntil ? 429 : 401);
  }
  if (user.legacy_hash) {
    const salt = bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await passwordHash(password, salt);
    await env.DB.prepare("UPDATE users SET password_hash=?,password_salt=?,legacy_hash=NULL,updated_at=? WHERE login=?").bind(hash, salt, now(), login).run();
  }
  await env.DB.prepare("DELETE FROM login_attempts WHERE key=?").bind(key).run();
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at<=?").bind(now()).run();
  const token = randomToken(40); const tokenHash = await sha256(token);
  const hours = Math.min(24, Math.max(1, Number(env.SESSION_HOURS || 12)));
  const expiresAt = new Date(Date.now() + hours * 3600_000).toISOString();
  await env.DB.prepare("INSERT INTO sessions(token_hash,login,created_at,expires_at) VALUES(?,?,?,?)").bind(tokenHash, login, now(), expiresAt).run();
  await env.DB.prepare("UPDATE users SET last_seen_at=?,updated_at=? WHERE login=?").bind(now(), now(), login).run();
  await audit(env, request, login, "login_success", "auth", login);
  return respond(request, env, { token, expiresAt, user: safeUser(user) });
}

async function logout(request, env) {
  const auth = await requireAuth(request, env); if (auth.error) return auth.error;
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(auth.tokenHash).run();
  await audit(env, request, auth.user.login, "logout", "auth", auth.user.login);
  return respond(request, env, { ok: true });
}

async function changeOwnPassword(request, env, auth) {
  const body = await readJson(request, 20_000); const password = String(body.password || "");
  if (password.length < 10) return respond(request, env, { error: "Новый пароль должен быть не короче 10 символов" }, 400);
  const salt = bytesToB64(crypto.getRandomValues(new Uint8Array(16))); const hash = await passwordHash(password, salt);
  await env.DB.prepare("UPDATE users SET password_hash=?,password_salt=?,legacy_hash=NULL,force_password_change=0,updated_at=? WHERE login=?").bind(hash, salt, now(), auth.user.login).run();
  await audit(env, request, auth.user.login, "password_change", "user", auth.user.login);
  return respond(request, env, { ok: true });
}

async function publicSchedule(request, env) {
  const rows = await env.DB.prepare("SELECT payload FROM events ORDER BY updated_at DESC").all();
  return respond(request, env, { updated: now(), events: rows.results.map(x => JSON.parse(x.payload)) });
}
async function privateSchedule(request, env, auth) {
  const [active, deleted] = await Promise.all([env.DB.prepare("SELECT payload FROM events ORDER BY updated_at DESC").all(), env.DB.prepare("SELECT payload,deleted_at,deleted_by FROM deleted_events ORDER BY deleted_at DESC LIMIT 200").all()]);
  return respond(request, env, { updated: now(), events: active.results.map(x => JSON.parse(x.payload)), trash: roleAtLeast(auth.user, ["owner", "admin"]) ? deleted.results.map(x => ({ ...JSON.parse(x.payload), deletedAt: x.deleted_at, deletedBy: x.deleted_by })) : [] });
}
async function publicPromotions(request, env) {
  const rows = await env.DB.prepare("SELECT payload FROM promotions ORDER BY updated_at DESC").all();
  return respond(request, env, { updated: now(), items: rows.results.map(x => JSON.parse(x.payload)) });
}

function eventPayload(input, existing = {}) {
  const allowed = ["type","title","instructor","place","date","gather","start","duration","note","photo","dsHour","cancelled","cancelReason","done","history"];
  const out = { ...existing };
  for (const key of allowed) if (Object.hasOwn(input, key)) out[key] = input[key];
  out.title = cleanText(out.title, 200); out.place = cleanText(out.place, 200); out.instructor = cleanText(out.instructor, 200); out.note = cleanText(out.note, 2000);
  out.date = cleanText(out.date, 20); out.gather = cleanText(out.gather, 10); out.start = cleanText(out.start, 10); out.cancelReason = cleanText(out.cancelReason, 1000);
  out.duration = Math.min(300, Math.max(10, Number(out.duration || 45)));
  if (typeof out.photo === "string" && out.photo.length > 1_600_000) throw new Error("photo_too_large");
  return out;
}
async function findEvent(env, id) { return env.DB.prepare("SELECT * FROM events WHERE id=?").bind(id).first(); }
function canEditEvent(user, row) { return roleAtLeast(user, ["owner", "admin"]) || norm(row.owner_login) === norm(user.login); }

async function createEvent(request, env, auth) {
  const input = await readJson(request);
  const id = cleanText(input.id || crypto.randomUUID(), 200); const at = now();
  const payload = eventPayload(input); payload.id = id; payload.createdBy = auth.user.login; payload.createdAt = at; payload.updatedAt = at;
  await env.DB.prepare("INSERT INTO events(id,payload,owner_login,cancelled,done,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(id, JSON.stringify(payload), auth.user.login, payload.cancelled ? 1 : 0, payload.done ? 1 : 0, at, at).run();
  await audit(env, request, auth.user.login, "event_create", "event", id, payload.title);
  if (input.sendDiscord !== false) await discordEvent(env, payload, "create");
  return respond(request, env, { event: payload }, 201);
}
async function updateEvent(request, env, auth, id) {
  const row = await findEvent(env, id); if (!row) return respond(request, env, { error: "Занятие не найдено" }, 404);
  if (!canEditEvent(auth.user, row)) return respond(request, env, { error: "Недостаточно прав" }, 403);
  const input = await readJson(request); await snapshot(env, auth.user.login, `event_update:${id}`);
  const old = JSON.parse(row.payload); const payload = eventPayload(input, old); payload.id = id; payload.updatedAt = now();
  await env.DB.prepare("UPDATE events SET payload=?,cancelled=?,done=?,updated_at=? WHERE id=?").bind(JSON.stringify(payload), payload.cancelled ? 1 : 0, payload.done ? 1 : 0, payload.updatedAt, id).run();
  await audit(env, request, auth.user.login, "event_update", "event", id, payload.title);
  if (input.notifyDiscord) await discordEvent(env, payload, "update");
  return respond(request, env, { event: payload });
}
async function cancelEvent(request, env, auth, id) {
  const row = await findEvent(env, id); if (!row) return respond(request, env, { error: "Занятие не найдено" }, 404);
  if (!canEditEvent(auth.user, row)) return respond(request, env, { error: "Недостаточно прав" }, 403);
  const body = await readJson(request, 20_000); const reason = cleanText(body.reason, 1000);
  if (!reason) return respond(request, env, { error: "Укажите причину отмены" }, 400);
  await snapshot(env, auth.user.login, `event_cancel:${id}`);
  const payload = { ...JSON.parse(row.payload), cancelled: true, cancelReason: reason, updatedAt: now() };
  await env.DB.prepare("UPDATE events SET payload=?,cancelled=1,updated_at=? WHERE id=?").bind(JSON.stringify(payload), payload.updatedAt, id).run();
  await audit(env, request, auth.user.login, "event_cancel", "event", id, reason); await discordEvent(env, payload, "cancel");
  return respond(request, env, { event: payload });
}
async function finishEvent(request, env, auth, id) {
  const row = await findEvent(env, id); if (!row) return respond(request, env, { error: "Занятие не найдено" }, 404);
  if (!canEditEvent(auth.user, row)) return respond(request, env, { error: "Недостаточно прав" }, 403);
  const payload = { ...JSON.parse(row.payload), done: true, updatedAt: now() };
  await env.DB.prepare("UPDATE events SET payload=?,done=1,updated_at=? WHERE id=?").bind(JSON.stringify(payload), payload.updatedAt, id).run();
  await audit(env, request, auth.user.login, "event_finish", "event", id, payload.title);
  return respond(request, env, { event: payload });
}
async function deleteEvent(request, env, auth, id) {
  if (!roleAtLeast(auth.user, ["owner", "admin"])) return respond(request, env, { error: "Удалять могут только owner и admin" }, 403);
  const row = await findEvent(env, id); if (!row) return respond(request, env, { error: "Занятие не найдено" }, 404);
  await snapshot(env, auth.user.login, `event_delete:${id}`);
  await env.DB.batch([env.DB.prepare("INSERT OR REPLACE INTO deleted_events(id,payload,owner_login,deleted_at,deleted_by) VALUES(?,?,?,?,?)").bind(id, row.payload, row.owner_login, now(), auth.user.login), env.DB.prepare("DELETE FROM events WHERE id=?").bind(id)]);
  await audit(env, request, auth.user.login, "event_delete", "event", id);
  return respond(request, env, { ok: true });
}
async function restoreEvent(request, env, auth, id) {
  if (!roleAtLeast(auth.user, ["owner", "admin"])) return respond(request, env, { error: "Недостаточно прав" }, 403);
  const row = await env.DB.prepare("SELECT * FROM deleted_events WHERE id=?").bind(id).first(); if (!row) return respond(request, env, { error: "Занятие не найдено в корзине" }, 404);
  await snapshot(env, auth.user.login, `event_restore:${id}`);
  const payload = JSON.parse(row.payload); payload.updatedAt = now();
  await env.DB.batch([env.DB.prepare("INSERT OR REPLACE INTO events(id,payload,owner_login,cancelled,done,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(id, JSON.stringify(payload), row.owner_login, payload.cancelled ? 1 : 0, payload.done ? 1 : 0, payload.createdAt || now(), now()), env.DB.prepare("DELETE FROM deleted_events WHERE id=?").bind(id)]);
  await audit(env, request, auth.user.login, "event_restore", "event", id);
  return respond(request, env, { event: payload });
}

async function listUsers(request, env, auth) {
  if (!roleAtLeast(auth.user, ["owner", "admin"])) return respond(request, env, { error: "Недостаточно прав" }, 403);
  const rows = await env.DB.prepare("SELECT login,first_name,last_name,role,blocked,force_password_change,created_at,updated_at,last_seen_at FROM users ORDER BY last_name,first_name").all();
  return respond(request, env, { users: rows.results.map(safeUser) });
}
async function createUser(request, env, auth) {
  if (!roleAtLeast(auth.user, ["owner", "admin"])) return respond(request, env, { error: "Недостаточно прав" }, 403);
  const body = await readJson(request, 30_000); const login = norm(body.login); const password = String(body.password || "");
  let role = ["owner","admin","instructor"].includes(body.role) ? body.role : "instructor";
  if (auth.user.role !== "owner" && role !== "instructor") return respond(request, env, { error: "Только owner может назначить admin или owner" }, 403);
  if (!/^[\p{L}\p{N}_.-]{3,40}$/u.test(login) || password.length < 10) return respond(request, env, { error: "Логин от 3 символов, пароль от 10 символов" }, 400);
  const salt = bytesToB64(crypto.getRandomValues(new Uint8Array(16))); const hash = await passwordHash(password, salt); const at = now();
  await snapshot(env, auth.user.login, `user_create:${login}`);
  await env.DB.prepare("INSERT INTO users(login,first_name,last_name,role,password_hash,password_salt,blocked,force_password_change,created_at,updated_at) VALUES(?,?,?,?,?,?,0,1,?,?)")
    .bind(login, cleanText(body.first,100), cleanText(body.last,100), role, hash, salt, at, at).run();
  await audit(env, request, auth.user.login, "user_create", "user", login, role);
  return respond(request, env, { ok: true }, 201);
}
async function updateUser(request, env, auth, loginRaw) {
  if (!roleAtLeast(auth.user, ["owner", "admin"])) return respond(request, env, { error: "Недостаточно прав" }, 403);
  const login = norm(loginRaw); const target = await env.DB.prepare("SELECT * FROM users WHERE login=?").bind(login).first(); if (!target) return respond(request, env, { error: "Пользователь не найден" }, 404);
  if (auth.user.role !== "owner" && target.role !== "instructor") return respond(request, env, { error: "Admin не может менять owner или другого admin" }, 403);
  const body = await readJson(request, 30_000); let role = target.role;
  if (body.role !== undefined) {
    if (auth.user.role !== "owner" || !["owner","admin","instructor"].includes(body.role)) return respond(request, env, { error: "Роль может менять только owner" }, 403);
    role = body.role;
  }
  let hash = target.password_hash, salt = target.password_salt, legacy = target.legacy_hash, force = target.force_password_change;
  if (body.password !== undefined) {
    const password = String(body.password || ""); if (password.length < 10) return respond(request, env, { error: "Пароль должен быть не короче 10 символов" }, 400);
    salt = bytesToB64(crypto.getRandomValues(new Uint8Array(16))); hash = await passwordHash(password, salt); legacy = null; force = 1;
  }
  await snapshot(env, auth.user.login, `user_update:${login}`);
  await env.DB.prepare("UPDATE users SET first_name=?,last_name=?,role=?,blocked=?,password_hash=?,password_salt=?,legacy_hash=?,force_password_change=?,updated_at=? WHERE login=?")
    .bind(body.first !== undefined ? cleanText(body.first,100) : target.first_name, body.last !== undefined ? cleanText(body.last,100) : target.last_name, role, body.blocked !== undefined ? (body.blocked ? 1 : 0) : target.blocked, hash, salt, legacy, force, now(), login).run();
  if (body.blocked) await env.DB.prepare("DELETE FROM sessions WHERE login=?").bind(login).run();
  await audit(env, request, auth.user.login, "user_update", "user", login, JSON.stringify({ role, blocked: body.blocked, passwordChanged: body.password !== undefined }));
  return respond(request, env, { ok: true });
}
async function deleteUser(request, env, auth, loginRaw) {
  if (auth.user.role !== "owner") return respond(request, env, { error: "Удалять пользователей может только owner" }, 403);
  const login = norm(loginRaw); if (login === norm(auth.user.login)) return respond(request, env, { error: "Нельзя удалить собственный аккаунт" }, 400);
  await snapshot(env, auth.user.login, `user_delete:${login}`); await env.DB.prepare("DELETE FROM users WHERE login=?").bind(login).run();
  await audit(env, request, auth.user.login, "user_delete", "user", login);
  return respond(request, env, { ok: true });
}

async function createPromotion(request, env, auth) {
  const input = await readJson(request, 100_000); const id = cleanText(input.id || crypto.randomUUID(), 200); const at = now();
  const payload = { ...input, id, createdBy: auth.user.login, created: input.created || at, author: cleanText(input.author || `${auth.user.last_name || ""} ${auth.user.first_name || ""}`, 200), name: cleanText(input.name,200), link: cleanText(input.link,1000) };
  await env.DB.prepare("INSERT INTO promotions(id,payload,owner_login,created_at,updated_at) VALUES(?,?,?,?,?)").bind(id, JSON.stringify(payload), auth.user.login, at, at).run();
  await audit(env, request, auth.user.login, "promotion_create", "promotion", id, payload.name);
  return respond(request, env, { item: payload }, 201);
}
async function updatePromotion(request, env, auth, id) {
  const row = await env.DB.prepare("SELECT * FROM promotions WHERE id=?").bind(id).first(); if (!row) return respond(request, env, { error: "Запись не найдена" }, 404);
  if (!roleAtLeast(auth.user,["owner","admin"]) && norm(row.owner_login)!==norm(auth.user.login)) return respond(request, env, { error: "Недостаточно прав" }, 403);
  const body = await readJson(request,100_000); const payload = { ...JSON.parse(row.payload), ...body, id, updatedAt: now() };
  await env.DB.prepare("UPDATE promotions SET payload=?,updated_at=? WHERE id=?").bind(JSON.stringify(payload), payload.updatedAt, id).run();
  await audit(env, request, auth.user.login, "promotion_update", "promotion", id);
  return respond(request, env, { item: payload });
}

async function listAudit(request, env, auth) {
  if (auth.user.role !== "owner") return respond(request, env, { error: "Журнал доступен только owner" }, 403);
  const rows = await env.DB.prepare("SELECT id,at,actor,action,target_type,target_id,details FROM audit_log ORDER BY id DESC LIMIT 500").all();
  return respond(request, env, { entries: rows.results });
}
async function listBackups(request, env, auth) {
  if (auth.user.role !== "owner") return respond(request, env, { error: "Резервные копии доступны только owner" }, 403);
  const rows = await env.DB.prepare("SELECT id,at,actor,reason,length(snapshot) size FROM backups ORDER BY id DESC LIMIT 50").all();
  return respond(request, env, { backups: rows.results });
}
async function restoreBackup(request, env, auth, id) {
  if (auth.user.role !== "owner") return respond(request, env, { error: "Восстанавливать может только owner" }, 403);
  const row = await env.DB.prepare("SELECT * FROM backups WHERE id=?").bind(id).first(); if (!row) return respond(request, env, { error: "Копия не найдена" }, 404);
  await snapshot(env, auth.user.login, `before_backup_restore:${id}`); const snap = JSON.parse(row.snapshot); const statements = [];
  statements.push(env.DB.prepare("DELETE FROM events"), env.DB.prepare("DELETE FROM deleted_events"), env.DB.prepare("DELETE FROM promotions"));
  for (const x of snap.events || []) statements.push(env.DB.prepare("INSERT INTO events(id,payload,owner_login,cancelled,done,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(x.id,x.payload,x.owner_login,x.cancelled,x.done,x.created_at,x.updated_at));
  for (const x of snap.deleted || []) statements.push(env.DB.prepare("INSERT INTO deleted_events(id,payload,owner_login,deleted_at,deleted_by) VALUES(?,?,?,?,?)").bind(x.id,x.payload,x.owner_login,x.deleted_at,x.deleted_by));
  for (const x of snap.promotions || []) statements.push(env.DB.prepare("INSERT INTO promotions(id,payload,owner_login,created_at,updated_at) VALUES(?,?,?,?,?)").bind(x.id,x.payload,x.owner_login,x.created_at,x.updated_at));
  await env.DB.batch(statements); await audit(env, request, auth.user.login, "backup_restore", "backup", String(id));
  return respond(request, env, { ok: true });
}
async function dashboard(request, env, auth) {
  if (auth.user.role !== "owner") return respond(request, env, { error: "Сводка доступна только owner" }, 403);
  const [events, discord] = await Promise.all([env.DB.prepare("SELECT payload,cancelled,done FROM events").all(), env.DB.prepare("SELECT * FROM discord_stats WHERE id=1").first()]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year:"numeric",month:"2-digit",day:"2-digit" }).format(new Date());
  let todayCount=0, upcoming=0, cancelled=0;
  for (const row of events.results) { const e=JSON.parse(row.payload); if (row.cancelled) cancelled++; if (e.date===today) todayCount++; if (!row.done&&!row.cancelled&&String(e.date||"")>=today) upcoming++; }
  return respond(request, env, { today: todayCount, upcoming, cancelled, discord: { sent:Number(discord?.sent||0), deleted:Number(discord?.deleted||0), errors:Number(discord?.errors||0), lastChecked:discord?.last_checked_at||null } });
}

async function discordEvent(env, event, kind) {
  if (!env.DISCORD_WEBHOOK) return;
  const role = env.DISCORD_ROLE_ID ? `<@&${env.DISCORD_ROLE_ID}>\n` : "";
  const lines = kind === "cancel" ? [`**Занятие отменено · ${event.title || "УЦ"}**`, `Дата: ${event.date || "—"} · ${event.start || event.gather || "—"}`, `Причина: ${event.cancelReason || "—"}`] : [role + `**${event.title || "Занятие УЦ"}**`, event.instructor ? `Ведёт: ${event.instructor}` : "", event.place ? `Место: ${event.place}` : "", event.date ? `Дата: ${event.date} · ${event.start || event.gather || "—"}` : ""].filter(Boolean);
  try {
    const res = await fetch(env.DISCORD_WEBHOOK, { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({content:lines.join("\n"),allowed_mentions:{parse:[],roles:env.DISCORD_ROLE_ID?[env.DISCORD_ROLE_ID]:[]}}) });
    await env.DB.prepare(`INSERT INTO discord_stats(id,sent,deleted,errors,last_checked_at) VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET sent=sent+excluded.sent,errors=errors+excluded.errors,last_checked_at=excluded.last_checked_at`).bind(res.ok?1:0,0,res.ok?0:1,now()).run();
  } catch {
    await env.DB.prepare(`INSERT INTO discord_stats(id,sent,deleted,errors,last_checked_at) VALUES(1,0,0,1,?) ON CONFLICT(id) DO UPDATE SET errors=errors+1,last_checked_at=excluded.last_checked_at`).bind(now()).run();
  }
}
