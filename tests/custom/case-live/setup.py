#!/usr/bin/env python3
"""Живая проверка страниц «Дел»: наполнение настоящего Open WebUI выдуманными юристами и папками (как их завёл бы
юрист в чате) и дела — настоящей ручкой сервиса через Caddy. Только стандартная библиотека; данные выдуманы.

  setup.py owui  <адрес> <файл состояния>   — пользователи, группа выпуска, папки (вложенные и общие)
  setup.py cases <адрес> <файл состояния>   — «завести дело» для части папок: POST /legal-tools/api/cases/<папка>
"""
import json
import sys
import time
import urllib.error
import urllib.request

ADMIN = ("admin@live.example.com", "live-admin-pass-1")
PASSWORD = "live-user-pass-1"
USERS = {"owner": "Юрист Первый", "colleague": "Коллега Вторая", "outsider": "Юрист вне группы"}


def call(method, url, token=None, body=None, headers=None, ok=(200, 201)):
    data = json.dumps(body).encode() if body is not None else None
    h = {"Accept": "application/json", **({"Content-Type": "application/json"} if data is not None else {}),
         **({"Authorization": f"Bearer {token}"} if token else {}), **(headers or {})}
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw, status = r.read(), r.status
    except urllib.error.HTTPError as e:
        raw, status = e.read(), e.code
    try:
        out = json.loads(raw) if raw else None
    except ValueError:
        out = raw[:200].decode("utf-8", "replace")
    if status not in ok:
        raise SystemExit(f"FAIL {method} {url.split('/', 3)[-1]} → {status} {str(out)[:200]}")
    return out


def wait(url, seconds=240):
    end = time.time() + seconds
    while time.time() < end:
        try:
            with urllib.request.urlopen(url, timeout=5) as r:
                if r.status == 200:
                    return
        except Exception:  # noqa: BLE001 — сервис ещё поднимается
            pass
        time.sleep(2)
    raise SystemExit(f"FAIL не дождался {url}")


def signin(base, email, password):
    d = call("POST", base + "/api/v1/auths/signin", body={"email": email, "password": password})
    return d["token"], d["id"]


def owui(base, state_file, events_file=None):
    wait(base + "/health")
    admin, _ = signin(base, *ADMIN)
    if events_file:
        with open(events_file, encoding="utf-8") as fh:
            content = fh.read()
        call("POST", base + "/api/v1/functions/create", admin, {
            "id": "case_events", "name": "Дело: события папок", "content": content,
            "meta": {"description": "События папок дела (Д-2)"}}, ok=(200, 201, 400))
        call("POST", base + "/api/v1/functions/id/case_events/valves/update", admin, {
            "TOOLS_URL": "http://legal-tools-api:8000", "EVENTS_SECRET": "live-events-secret-0123456789"})
        fn = call("GET", base + "/api/v1/functions/id/case_events", admin)
        if not fn.get("is_active"):
            call("POST", base + "/api/v1/functions/id/case_events/toggle", admin)
        if not fn.get("is_global"):
            call("POST", base + "/api/v1/functions/id/case_events/toggle/global", admin)
    tok, uid = {}, {}
    for key, name in USERS.items():
        email = f"{key}@live.example.com"
        call("POST", base + "/api/v1/auths/add", admin, {"name": name, "email": email, "password": PASSWORD, "role": "user"})
        tok[key], uid[key] = signin(base, email, PASSWORD)
    group = call("POST", base + "/api/v1/groups/create", admin,
                 {"name": "Дело — выпуск", "description": "живая проверка", "permissions": {}, "data": {}})["id"]
    call("POST", base + f"/api/v1/groups/id/{group}/users/add", admin, {"user_ids": [uid["owner"], uid["colleague"]]})

    def folder(who, name, parent=None):
        return call("POST", base + "/api/v1/folders/", tok[who], {"name": name, **({"parent_id": parent} if parent else {})})["id"]

    def share(who, fid, to, permission):
        call("POST", base + f"/api/v1/folders/{fid}/access/update", tok[who], {
            "access_grants": [{"principal_type": "user", "principal_id": uid[to], "permission": permission}],
            "share_mode": "continue"})

    f = {"wind": folder("owner", "Северный ветер — поставка"), "guseva": folder("owner", "Гусева М. О. — раздел имущества")}
    f["arbitrage"] = folder("owner", "Арбитраж")
    f["year"] = folder("owner", "2025", f["arbitrage"])
    f["a40"] = folder("owner", "А40-123456/2025", f["year"])
    f["beta"] = folder("colleague", "Бета-Логистик (апелляция)")
    f["tikhonov"] = folder("colleague", "Тихонов — трудовой спор")
    f["mironov"] = folder("colleague", "Миронов Д. П. — наследство")
    share("colleague", f["beta"], "owner", "write")
    share("colleague", f["tikhonov"], "owner", "read")
    share("colleague", f["mironov"], "owner", "read")
    f["outside"] = folder("outsider", "Папка юриста вне группы")
    json.dump({"base": base, "group": group, "folders": f, "password": PASSWORD,
               "emails": {k: f"{k}@live.example.com" for k in USERS}}, open(state_file, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(f"OK   Open WebUI: 3 юриста, группа выпуска, {len(f)} папок (вложенные и общие)")


def cases(base, state_file):
    s = json.load(open(state_file, encoding="utf-8"))
    wait(base + "/legal-tools/health")
    write = {"X-Ai-Case": "1", "Origin": base}
    for who, key in (("owner", "wind"), ("owner", "a40"), ("colleague", "beta"), ("colleague", "mironov")):
        tok, _ = signin(base, s["emails"][who], s["password"])
        d = call("POST", base + f"/legal-tools/api/cases/{s['folders'][key]}", tok, headers=write)
        assert d["created"] is True, d
    tok, _ = signin(base, s["emails"]["owner"], s["password"])
    d = call("GET", base + "/legal-tools/api/cases", tok)
    got = (len(d["own"]), len(d["shared"]), sum(1 for x in d["own"] + d["shared"] if x["case"]))
    assert got == (5, 3, 4), got
    print("OK   legal-tools через Caddy: дела заведены ручкой сервиса; у юриста 5 своих папок, 3 общих, 4 дела")


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "owui":
        owui(sys.argv[2].rstrip("/"), sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else None)
    else:
        cases(sys.argv[2].rstrip("/"), sys.argv[3])
