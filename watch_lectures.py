# -*- coding: utf-8 -*-
"""
Раз в 10 минут смотрит schedule.json.
Если до НАЧАЛА занятия 45–90 минут — одно сообщение в Discord.
Когда занятие закончилось — удаляет анонс в Discord.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

MSK = timezone(timedelta(hours=3))
HOOK = os.environ.get(
    "DISCORD_WEBHOOK",
    "https://discord.com/api/webhooks/1546853118342598676/qWuJG8-N_qg2kfEs4G8mn3WETk5lZCV7_6zD4pFa9cKrYUluSCGBRgSwyvLuMuAiKWG5",
).strip()
ROLE = "".join(c for c in os.environ.get("DISCORD_ROLE_ID", "1546842057891643502") if c.isdigit())
SCHED = os.environ.get(
    "SCHEDULE_URL",
    "https://raw.githubusercontent.com/Tophik2345/uc-schedule/main/schedule.json",
).strip()
ROOT = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(ROOT, "ds_pings.json")
WINDOW = (45, 90)
KINDS = {
    "lecture": "Лекция",
    "training": "Тренировка",
    "exam": "Экзамен",
    "patrol": "Патруль",
}


def log(*a):
    print(*a, flush=True)


def http_get(url):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "uc-lecture-watch",
            "Accept": "application/json",
            "Cache-Control": "no-cache",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8")


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else default
    except Exception:
        return default


def save_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def unix_msk(date, time_s):
    if not date or not time_s:
        return 0
    try:
        y, mo, d = [int(x) for x in str(date).split("-")[:3]]
        parts = str(time_s).strip().split(":")
        hh = int(parts[0])
        mm = int(parts[1]) if len(parts) > 1 else 0
        if not (0 <= hh <= 23 and 0 <= mm <= 59):
            return 0
        return int(datetime(y, mo, d, hh, mm, tzinfo=MSK).timestamp())
    except Exception:
        return 0


def ping_key(ev, start):
    eid = str(ev.get("id") or "").strip()
    if eid:
        return "hour:%s:%s" % (eid, start)
    return "hour:%s|%s|%s" % (ev.get("date"), start, ev.get("title") or "")


def msg(ev):
    start = unix_msk(ev.get("date"), ev.get("start") or ev.get("gather"))
    gather = unix_msk(ev.get("date"), ev.get("gather"))
    kind = KINDS.get(ev.get("type"), ev.get("type") or "Занятие")
    ping = "<@&%s>" % ROLE if ROLE else ""
    lines = [
        ping,
        "**Через час · %s · %s**" % (kind, ev.get("title") or "УЦ"),
        ev.get("instructor") and ("Ведёт: " + str(ev.get("instructor"))),
        ev.get("place") and ("Место: " + str(ev.get("place"))),
        gather and ("Сбор: <t:%s:t>" % gather),
        start and ("Начало: <t:%s:F>" % start),
        start and ("До начала: <t:%s:R>" % start),
        ev.get("note") and ("Комментарий: " + str(ev.get("note"))),
    ]
    return "\n".join(x for x in lines if x)[:1900]


def hook_base():
    return HOOK.split("?")[0].rstrip("/")


def post(text):
    url = hook_base() + "?wait=true"
    data = json.dumps(
        {
            "content": text,
            "allowed_mentions": {"parse": [], "roles": [ROLE] if ROLE else []},
        },
        ensure_ascii=False,
    ).encode("utf-8")
    last = None
    for attempt in range(3):
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read().decode("utf-8", "replace")
            try:
                return json.loads(raw).get("id")
            except Exception:
                return None
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:300]
            last = RuntimeError("Discord %s: %s" % (e.code, body))
            if e.code in (429, 500, 502, 503, 504) and attempt < 2:
                time.sleep(2 * (attempt + 1))
                continue
            raise last
    raise last


def delete_msg(mid):
    if not mid:
        return False
    url = hook_base() + "/messages/" + str(mid)
    req = urllib.request.Request(url, method="DELETE")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            r.read()
        return True
    except urllib.error.HTTPError as e:
        if e.code in (404, 204):
            return True
        log("DEL FAIL", mid, e.code)
        return False
    except Exception as e:
        log("DEL FAIL", mid, e)
        return False


def ev_end(ev, start):
    mins = int(ev.get("duration") or 45)
    end_s = unix_msk(ev.get("date"), ev.get("end"))
    if end_s:
        return end_s
    return start + max(10, mins) * 60 if start else 0


def load_events():
    stamp = int(datetime.now(timezone.utc).timestamp())
    sep = "&" if "?" in SCHED else "?"
    raw = json.loads(http_get("%s%st=%s" % (SCHED, sep, stamp)))
    events = raw.get("events") if isinstance(raw, dict) else raw
    if not isinstance(events, list):
        raise RuntimeError("schedule.json без списка events")
    return events


def prune(sent, events, now_ts):
    alive = set()
    for ev in events:
        if not isinstance(ev, dict):
            continue
        start = unix_msk(ev.get("date"), ev.get("start") or ev.get("gather"))
        if start and start + 12 * 3600 >= now_ts:
            alive.add(ping_key(ev, start))
    return [k for k in sent if k in alive]


def dump(sent, now, extra=None):
    data = {"sent": sent, "checked": now.isoformat()}
    if extra:
        data.update(extra)
    save_json(STATE, data)


def main():
    hook = HOOK.lower()
    if not (hook.startswith("https://") and "/api/webhooks/" in hook):
        raise SystemExit(
            "Нет DISCORD_WEBHOOK. GitHub → Settings → Secrets and variables → Actions → New secret"
        )

    now = datetime.now(MSK)
    now_ts = int(now.timestamp())
    events = load_events()
    st = load_json(STATE, {"sent": [], "msgs": {}})
    sent = [str(x) for x in (st.get("sent") or [])]
    msgs = {str(k): str(v) for k, v in (st.get("msgs") or {}).items() if v}
    sent_set = set(sent)
    posted = 0
    deleted = 0
    errors = 0

    for ev in events:
        if not isinstance(ev, dict):
            continue
        start = unix_msk(ev.get("date"), ev.get("start") or ev.get("gather"))
        ended = bool(ev.get("done")) or (start and ev_end(ev, start) <= now_ts)
        ids = []
        if ev.get("dsId"):
            ids.append(str(ev.get("dsId")))
        key = ping_key(ev, start) if start else ""
        if key and key in msgs:
            ids.append(msgs[key])
        if ended:
            for mid in ids:
                if delete_msg(mid):
                    deleted += 1
            if key in msgs:
                msgs.pop(key, None)
            continue
        if not start:
            continue
        mins = (start - now_ts) / 60.0
        if key in sent_set:
            continue
        if not (WINDOW[0] <= mins <= WINDOW[1]):
            continue
        try:
            mid = post(msg(ev))
        except Exception as e:
            errors += 1
            log("FAIL", ev.get("title"), e)
            continue
        sent.append(key)
        sent_set.add(key)
        if mid:
            msgs[key] = str(mid)
        posted += 1
        dump(sent, now, {"msgs": msgs})
        log("SENT", ev.get("title"), "через %s мин" % int(mins))

    sent = prune(sent, events, now_ts)
    dump(sent, now, {"msgs": msgs, "posted": posted, "deleted": deleted, "errors": errors, "events": len(events)})
    log("ok posted=%s deleted=%s errors=%s events=%s" % (posted, deleted, errors, len(events)))
    if errors and not posted:
        sys.exit(1)


if __name__ == "__main__":
    main()
