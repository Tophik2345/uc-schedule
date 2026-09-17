# -*- coding: utf-8 -*-
"""Discord watcher using the live Supabase schedule.

Runs every 10 minutes from GitHub Actions.
- Posts one reminder 45-90 minutes before a lesson.
- Deletes the lesson Discord announcement when the configured duration ends.
- Also removes the reminder message when the lesson ends.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

MSK = timezone(timedelta(hours=3))
HOOK = os.environ.get("DISCORD_WEBHOOK", "").strip()
ROLE = "".join(c for c in (os.environ.get("DISCORD_ROLE_ID") or "1541035371712741479") if c.isdigit())
API = os.environ.get(
    "UC_API",
    "https://hpeqnqsgcqskjpdjkxcm.supabase.co/functions/v1/uc-api",
).strip()
ROOT = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(ROOT, "ds_pings.json")
WINDOW = (45, 90)
KINDS = {"lecture": "Лекция", "training": "Тренировка", "exam": "Экзамен", "patrol": "Патруль"}


def log(*args):
    print(*args, flush=True)


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
        hh, mm = [int(x) for x in str(time_s).strip().split(":")[:2]]
        return int(datetime(y, mo, d, hh, mm, tzinfo=MSK).timestamp())
    except Exception:
        return 0


def ping_key(ev, start):
    eid = str(ev.get("id") or "").strip()
    return "hour:%s:%s" % (eid or (ev.get("date") or "unknown"), start)


def hook_base():
    return HOOK.split("?")[0].rstrip("/")


def discord_post(text):
    payload = {
        "content": text[:1900],
        "allowed_mentions": {"parse": [], "roles": [ROLE] if ROLE else []},
    }
    req = urllib.request.Request(
        hook_base() + "?wait=true",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=35) as r:
                raw = r.read().decode("utf-8", "replace")
            return str(json.loads(raw).get("id") or "")
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:300]
            last = RuntimeError("Discord %s: %s" % (e.code, body))
            if e.code in (429, 500, 502, 503, 504) and attempt < 2:
                time.sleep(2 * (attempt + 1))
                continue
            raise last
    raise last


def discord_delete(mid):
    if not mid:
        return False
    req = urllib.request.Request(hook_base() + "/messages/" + str(mid), method="DELETE")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            r.read()
        return True
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return True
        log("DEL FAIL", mid, e.code)
        return False
    except Exception as e:
        log("DEL FAIL", mid, e)
        return False


def load_events():
    body = json.dumps({"action": "public", "input": {}}).encode("utf-8")
    req = urllib.request.Request(
        API,
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": "uc-discord-watch"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode("utf-8"))
    if isinstance(data, list):
        data = data[0] if data else {}
    events = data.get("events") if isinstance(data, dict) else None
    if not isinstance(events, list):
        raise RuntimeError("Supabase public schedule did not return events")
    return events


def event_end(ev, start):
    explicit = unix_msk(ev.get("date"), ev.get("end"))
    if explicit:
        return explicit
    try:
        mins = max(10, int(ev.get("duration") or 45))
    except Exception:
        mins = 45
    return start + mins * 60 if start else 0


def reminder_text(ev):
    start = unix_msk(ev.get("date"), ev.get("start") or ev.get("gather"))
    gather = unix_msk(ev.get("date"), ev.get("gather"))
    kind = KINDS.get(ev.get("type"), ev.get("type") or "Занятие")
    lines = [
        ("<@&%s>" % ROLE) if ROLE else "",
        "**Через час · %s · %s**" % (kind, ev.get("title") or "УЦ"),
        ev.get("instructor") and ("Ведёт: " + str(ev.get("instructor"))),
        ev.get("place") and ("Место: " + str(ev.get("place"))),
        gather and ("Сбор: <t:%s:t>" % gather),
        start and ("Начало: <t:%s:F>" % start),
        start and ("До начала: <t:%s:R>" % start),
    ]
    return "\n".join(x for x in lines if x)


def main():
    if not (HOOK.lower().startswith("https://") and "/api/webhooks/" in HOOK.lower()):
        raise SystemExit("DISCORD_WEBHOOK is not configured")

    now = datetime.now(MSK)
    now_ts = int(now.timestamp())
    events = load_events()
    state = load_json(STATE, {"sent": [], "msgs": {}})
    sent = {str(x) for x in (state.get("sent") or [])}
    msgs = {str(k): str(v) for k, v in (state.get("msgs") or {}).items() if v}
    posted = deleted = errors = 0

    for ev in events:
        if not isinstance(ev, dict):
            continue
        start = unix_msk(ev.get("date"), ev.get("start") or ev.get("gather"))
        if not start:
            continue
        key = ping_key(ev, start)
        ended = bool(ev.get("done")) or bool(ev.get("cancelled")) or event_end(ev, start) <= now_ts

        if ended:
            ids = []
            if ev.get("dsId"):
                ids.append(str(ev.get("dsId")))
            if key in msgs:
                ids.append(msgs[key])
            for mid in dict.fromkeys(ids):
                if discord_delete(mid):
                    deleted += 1
            msgs.pop(key, None)
            sent.discard(key)
            continue

        mins = (start - now_ts) / 60.0
        if key not in sent and WINDOW[0] <= mins <= WINDOW[1]:
            try:
                mid = discord_post(reminder_text(ev))
                sent.add(key)
                if mid:
                    msgs[key] = mid
                posted += 1
            except Exception as e:
                errors += 1
                log("POST FAIL", ev.get("title"), e)

    save_json(STATE, {
        "sent": sorted(sent),
        "msgs": msgs,
        "checked": now.isoformat(),
        "posted": posted,
        "deleted": deleted,
        "errors": errors,
        "events": len(events),
    })
    log("ok posted=%s deleted=%s errors=%s events=%s" % (posted, deleted, errors, len(events)))
    if errors and not posted:
        sys.exit(1)


if __name__ == "__main__":
    main()
