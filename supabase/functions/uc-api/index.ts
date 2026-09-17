const URL = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PUBLIC_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const ACADEMY_ROLE_ID = '1541035371712741479';
const origins = new Set(['https://tophik2345.github.io', 'http://localhost:4173', 'http://127.0.0.1:4173']);

class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function auth(path: string, body?: unknown, token = KEY, method = body ? 'POST' : 'GET', retries = 0): Promise<any> {
  const response = await fetch(`${URL}/auth/v1/${path}`, {
    method,
    headers: { apikey: KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (retries > 0 && (response.status === 429 || response.status >= 500)) {
      await pause(300 * (4 - retries));
      return auth(path, body, token, method, retries - 1);
    }
    const message = path.startsWith('token')
      ? 'Неверный логин или пароль'
      : path === 'user'
        ? 'Сеанс завершён. Войдите снова'
        : 'Не удалось выполнить действие с аккаунтом';
    throw new ApiError(message, response.status === 401 ? 401 : response.status === 429 ? 429 : 400);
  }
  return data;
}

async function rpc(name: string, data: unknown): Promise<any> {
  const response = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(value?.code === 'P0001' ? value.message : 'Не удалось сохранить данные. Обновите страницу');
  return value;
}

async function discordPost(content: string, photo = '', mentionAcademy = false, settingKey = 'discord_webhook') {
  const webhook = await rpc('uc_private_setting', { p_key: settingKey });
  if (!webhook) throw new ApiError('Discord не настроен');
  const text = `${mentionAcademy ? `<@&${ACADEMY_ROLE_ID}>\n` : ''}${content}`;
  const payload: any = { content: text.slice(0, 1900), allowed_mentions: { parse: [], roles: mentionAcademy ? [ACADEMY_ROLE_ID] : [] } };
  let body: BodyInit, headers: Record<string, string> = {};
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(photo || '');
  if (match) {
    const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const form = new FormData();
    payload.attachments = [{ id: 0, filename: `place.${ext}` }];
    payload.embeds = [{ image: { url: `attachment://place.${ext}` } }];
    form.append('payload_json', JSON.stringify(payload));
    form.append('files[0]', new Blob([bytes], { type: `image/${match[1]}` }), `place.${ext}`);
    body = form;
  } else {
    headers['Content-Type'] = 'application/json'; body = JSON.stringify(payload);
  }
  const response = await fetch(`${String(webhook).split('?')[0]}?wait=true`, { method: 'POST', headers, body });
  if (!response.ok) throw new ApiError(`Discord не принял сообщение (${response.status})`);
  return await response.json().catch(() => ({}));
}

async function discordDelete(messageId: string) {
  if (!messageId) return;
  const webhook = await rpc('uc_private_setting', { p_key: 'discord_webhook' });
  if (!webhook) return;
  const response = await fetch(`${String(webhook).split('?')[0]}/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) throw new ApiError(`Discord не удалил старое сообщение (${response.status})`);
}

const eventMessage = (action: string, e: any) => {
  const kind: Record<string, string> = { lecture: 'Лекция', training: 'Тренировка', exam: 'Экзамен', patrol: 'Патруль' };
  const label = action === 'event.cancel' ? 'Занятие отменено' : action === 'event.edit' || action === 'event.move' ? 'Занятие изменено' : action === 'event.done' ? 'Занятие проведено' : action === 'event.delete' ? 'Занятие удалено' : 'Новое занятие';
  return [`**${label} · ${kind[e.type] || e.type || 'УЦ'} · ${e.title || 'УЦ'}**`, `Дата: ${e.date || '—'} · сбор ${e.gather || '—'} · начало ${e.start || '—'}`, `Место: ${e.place || '—'}`, `Ведёт: ${e.instructor || '—'}`, e.cancelReason ? `Причина: ${e.cancelReason}` : '', e.note ? `Комментарий: ${e.note}` : ''].filter(Boolean).join('\n');
};

const loginName = (value: unknown) => String(value ?? '').trim().toLowerCase();
const email = (value: string) => `u-${Array.from(new TextEncoder().encode(value), b => b.toString(16).padStart(2, '0')).join('')}@accounts.uc-schedule.invalid`;
const validPassword = (value: unknown) => {
  if (typeof value !== 'string' || value.length < 12 || new TextEncoder().encode(value).length > 72) {
    throw new ApiError('Пароль: от 12 символов, не более 72 байт');
  }
  return value;
};
const decodeClaims = (token: string) => {
  const part = token.split('.')[1];
  if (!part) throw new ApiError('Сеанс завершён. Войдите снова', 401);
  const normalized = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  try { return JSON.parse(atob(normalized)); } catch { throw new ApiError('Сеанс завершён. Войдите снова', 401); }
};
const temporaryPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return `Uc26-${Array.from(bytes, b => chars[b % chars.length]).join('')}`;
};

const allowed = new Set([
  'me', 'schedule', 'event.create', 'event.edit', 'event.move', 'event.cancel', 'event.done', 'event.delete',
  'event.restore', 'promotions', 'promotion.create', 'promotion.done', 'promotion.delete', 'stats.send',
  'owner.data', 'owner.user', 'owner.ban', 'owner.registration',
]);

Deno.serve(async request => {
  const origin = request.headers.get('Origin') || '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  };
  if (origins.has(origin)) Object.assign(headers, {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization,apikey,content-type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
  });
  const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
  if (origin && !origins.has(origin)) return reply({ error: 'Источник запроса не разрешён' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply({ error: 'Метод не поддерживается' }, 405);

  try {
    if (Number(request.headers.get('content-length') || 0) > 650000) throw new ApiError('Запрос слишком большой', 413);
    const raw = await request.text();
    if (raw.length > 650000) throw new ApiError('Запрос слишком большой', 413);
    const parsed = JSON.parse(raw);
    const action = parsed?.action;
    const input = parsed?.input ?? {};
    if (typeof action !== 'string' || !input || Array.isArray(input) || typeof input !== 'object') throw new ApiError('Некорректные данные');

    if (action === 'public') return reply(await rpc('uc_public_schedule', {}));
    if (action === 'password.request' || action === 'password.reset') {
      return reply({ error: 'Самостоятельный сброс отключён. Получите временный пароль у владельца.' }, 403);
    }
    if (action === 'register') {
      const login = loginName(input.login);
      if (!/^[a-z0-9_.-]{3,32}$/.test(login)) throw new ApiError('Логин: 3–32 латинских буквы, цифры, точка, дефис или подчёркивание');
      validPassword(input.password);
      const first = String(input.first || '').trim(), last = String(input.last || '').trim();
      if (!first || !last || first.length > 60 || last.length > 60) throw new ApiError('Введите имя и фамилию (до 60 символов)');
      if (!await rpc('uc_gate', { p_key: 'register:global', p_limit: 50, p_seconds: 3600 }) ||
          !await rpc('uc_gate', { p_key: `register:${login}`, p_limit: 5, p_seconds: 900 })) throw new ApiError('Слишком много попыток регистрации. Попробуйте позже', 429);
      if (!await rpc('uc_registration', { p_login: login, p_code: String(input.code || '') })) throw new ApiError('Неверный спецпароль или логин уже занят');
      const user = await auth('admin/users', { email: email(login), password: input.password, email_confirm: true });
      try { await rpc('uc_attach', { p_id: user.id, p_login: login, p_first: first, p_last: last }); }
      catch (error) { await auth(`admin/users/${user.id}`, undefined, KEY, 'DELETE').catch(() => {}); throw error; }
      return reply({ ok: true });
    }
    if (action === 'login') {
      const login = loginName(input.login);
      if (!/^[a-zа-яё0-9_.-]{2,32}$/i.test(login)) throw new ApiError('Неверный логин или пароль');
      if (!await rpc('uc_gate', { p_key: `login:${login}`, p_limit: 12, p_seconds: 900 })) throw new ApiError('Слишком много попыток. Подождите 15 минут', 429);
      const session = await auth('token?grant_type=password', { email: email(login), password: input.password }, PUBLIC_KEY);
      const claims = decodeClaims(session.access_token);
      const me = await rpc('uc_action', { p_actor: session.user.id, p_session: claims.session_id, p_action: 'session.open', p_input: { device: input.device } });
      return reply({ session: { access_token: session.access_token, refresh_token: session.refresh_token, expires_at: Math.floor(Date.now() / 1000) + session.expires_in }, me });
    }
    if (action === 'refresh') {
      const session = await auth('token?grant_type=refresh_token', { refresh_token: input.refresh_token }, PUBLIC_KEY);
      const claims = decodeClaims(session.access_token);
      const me = await rpc('uc_action', { p_actor: session.user.id, p_session: claims.session_id, p_action: 'me', p_input: {} });
      return reply({ session: { access_token: session.access_token, refresh_token: session.refresh_token, expires_at: Math.floor(Date.now() / 1000) + session.expires_in }, me });
    }

    const token = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
    if (!token) throw new ApiError('Войдите в аккаунт', 401);
    const user = await auth('user', undefined, token);
    const claims = decodeClaims(token);
    const call = (name: string, value: unknown = {}) => rpc('uc_action', { p_actor: user.id, p_session: claims.session_id, p_action: name, p_input: value });
    const me = await call('me');

    if (action === 'logout') {
      await call('logout');
      await auth('logout?scope=global', undefined, token, 'POST').catch(() => {});
      return reply({ ok: true });
    }
    if (action === 'password') {
      validPassword(input.password);
      if (!await rpc('uc_gate', { p_key: `password:${user.id}`, p_limit: 5, p_seconds: 900 })) throw new ApiError('Попробуйте позже', 429);
      const verified = await auth('token?grant_type=password', { email: user.email, password: input.current }, PUBLIC_KEY);
      await call('password.changed');
      await auth(`admin/users/${user.id}`, { password: input.password }, KEY, 'PUT', 3);
      await auth('logout?scope=global', undefined, verified.access_token, 'POST').catch(() => {});
      return reply({ ok: true });
    }
    if (action === 'owner.reset') {
      if (!me.owner || me.mustChangePassword) throw new ApiError('Нужны права хозяина', 403);
      validPassword(input.password);
      await call('owner.user', { id: input.id, operation: 'reset' });
      await auth(`admin/users/${input.id}`, { password: input.password }, KEY, 'PUT', 3);
      return reply({ ok: true });
    }
    if (action === 'owner.bulk_reset') {
      if (!me.owner || me.mustChangePassword) throw new ApiError('Нужны права хозяина', 403);
      if (!await rpc('uc_gate', { p_key: `bulk-reset:${user.id}`, p_limit: 3, p_seconds: 300 })) throw new ApiError('Массовый сброс уже выполнялся. Подождите несколько минут', 429);
      const data = await call('owner.data');
      const targets = (data.users || []).filter((profile: any) => !profile.owner && !profile.deleted);
      const passwords: Array<{ login: string; password: string }> = [];
      const failures: Array<{ login: string; error: string }> = [];
      let cursor = 0;
      const worker = async () => {
        while (cursor < targets.length) {
          const profile = targets[cursor++];
          const password = temporaryPassword();
          try {
            await auth(`admin/users/${profile.id}`, { password }, KEY, 'PUT', 3);
            await call('owner.user', { id: profile.id, operation: 'reset' });
            passwords.push({ login: profile.login, password });
          } catch (error) {
            failures.push({ login: profile.login, error: error instanceof ApiError ? error.message : 'Ошибка сброса' });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker));
      passwords.sort((a, b) => a.login.localeCompare(b.login));
      failures.sort((a, b) => a.login.localeCompare(b.login));
      return reply({ passwords, failures, total: targets.length }, failures.length ? 207 : 200);
    }
    if (action === 'owner.discord_test') {
      if (!me.owner) throw new ApiError('Нужны права хозяина', 403);
      const lecture = await discordPost('Проверка канала занятий…');
      if (lecture?.id) await discordDelete(String(lecture.id));
      const report = await discordPost('Проверка канала отчётов…', '', false, 'discord_report_webhook');
      if (report?.id) {
        const webhook = await rpc('uc_private_setting', { p_key: 'discord_report_webhook' });
        await fetch(`${String(webhook).split('?')[0]}/messages/${encodeURIComponent(String(report.id))}`, { method: 'DELETE' });
      }
      return reply({ ok: true });
    }
    if (!allowed.has(action) || (action === 'owner.user' && input.operation === 'reset')) throw new ApiError('Неизвестное действие');
    let oldDiscordMessageId = '';
    if (action.startsWith('event.') && action !== 'event.create' && input.id) {
      const before = await call('schedule');
      oldDiscordMessageId = String((before.events || []).find((e: any) => e.id === input.id)?.discordMessageId || '');
    }
    const result = await call(action, input);
    if (action.startsWith('event.')) {
      if (oldDiscordMessageId) await discordDelete(oldDiscordMessageId);
      if (['event.create', 'event.edit', 'event.move', 'event.restore'].includes(action) && result?.sendDiscord !== false) {
        const message = await discordPost(eventMessage(action, result), result.photo || '', true);
        if (message?.id && result?.id) await rpc('uc_event_discord_id', { p_id: result.id, p_message_id: String(message.id) });
      }
    }
    if (action === 'stats.send') {
      const schedule = await call('schedule');
      const from = String(input.from || '0000-01-01'), to = String(input.to || '9999-12-31'), name = String(input.name || '').trim();
      const events = (schedule.events || []).filter((e: any) => (!name || e.instructor === name) && String(e.date || '') >= from && String(e.date || '') <= to);
      const done = events.filter((e: any) => e.done).length, cancelled = events.filter((e: any) => e.cancelled).length;
      const minutes = events.reduce((sum: number, e: any) => sum + (Number(e.duration) || 45), 0);
      await discordPost([`**${name ? `Отчёт УЦ · ${name}` : 'ИТОГО ПО УЦ'}**`, `Период: ${input.from || 'всё время'} — ${input.to || 'всё время'}`, `Всего занятий: ${events.length}`, `Проведено: ${done}`, `Отменено: ${cancelled}`, name ? `Минут: ${minutes}` : '', `Отправил: ${[me.last, me.first].filter(Boolean).join(' ') || me.login}`].filter(Boolean).join('\n'), '', false, 'discord_report_webhook');
    }
    return reply(result);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return reply({ error: error instanceof ApiError ? error.message : 'Не удалось обработать запрос' }, error instanceof ApiError ? error.status : 400);
  }
});
