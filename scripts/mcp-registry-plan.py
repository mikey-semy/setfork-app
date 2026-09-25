#!/usr/bin/env python3
"""Что делать с записью SetFork в реестре MCP при выкатке: publish / skip / отказ.

Запись описывает сервер MCP, и её версия своя (server.json → version), не версия приложения.
Правило (решение владельца 25.09):
  - такой версии в реестре нет            → publish;
  - есть, и поверхность та же             → skip (уже опубликовано);
  - есть, а поверхность другая            → ОТКАЗ: поверхность изменилась, а версию не подняли —
                                             опубликовать нельзя (версии в реестре неизменяемы).

Поверхность — `_meta["io.modelcontextprotocol.registry/publisher-provided"].surface`: имена
инструментов, сценариев и шаблонов ресурсов. Что она совпадает с кодом, держит
tests/features/mcp/server-json.test.ts.

  - версии нет, но она НИЖЕ последней опубликованной → ОТКАЗ: реестр её примет, но
    последней она не станет, и клиенты тихо останутся на старой поверхности.

Запуск: `mcp-registry-plan.py --fetch server.json` — сам спрашивает реестр (так в CI; код 2 —
реестр недоступен). Для тестов — без сети: `mcp-registry-plan.py server.json <ответ> [<последняя>]`.
Вход тестового режима: путь к server.json, ответ реестра на GET /v0/servers/{name}/versions/{version} файлом
(пусто, нет файла или тело без записи — версии нет) и, необязательно, последняя
опубликованная версия. Выход: слово в stdout, код 0; отказ — код 1.
"""
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

META = "io.modelcontextprotocol.registry/publisher-provided"
REGISTRY = "https://registry.modelcontextprotocol.io"
# Сеть до реестра недоступна — не «отказ» и не «публиковать»: решать не по чему.
EXIT_NETWORK = 2


def surface(doc):
    return (doc.get("_meta") or {}).get(META, {}).get("surface")


def semver(v):
    return tuple(int(x) for x in v.split("-")[0].split("+")[0].split("."))


def plan(local, published, latest=None):
    record = None
    if isinstance(published, dict):
        record = published.get("server", published)
        # Тело 404 (`{"title": "Not Found", …}`) записью не является.
        if not isinstance(record, dict) or record.get("name") != local["name"]:
            record = None
    if record is None:
        if latest and semver(local["version"]) < semver(latest):
            raise SystemExit(
                f"server.json: версия {local['version']} ниже последней опубликованной {latest} — "
                "реестр не сделает её последней; подними version"
            )
        return "publish"
    if surface(record) == surface(local):
        return "skip"
    raise SystemExit(
        f"реестр уже содержит {local['name']} {local['version']} с другой поверхностью MCP: "
        "подними version в server.json (версии в реестре неизменяемы)"
    )


def fetch(local):
    """Ответ реестра по этой версии (None — её нет) и последняя опубликованная версия."""
    name = urllib.parse.quote(local["name"], safe="")
    try:
        with urllib.request.urlopen(f"{REGISTRY}/v0/servers/{name}/versions/{local['version']}", timeout=30) as r:
            published = json.load(r)
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
        published = None
    # Все версии ИМЕННО этой записи — точным адресом, а не поиском `?search=`: поиск
    # общий по реестру и бывает недоступен (500 и зависания 25.09), а этот ответ короткий.
    try:
        with urllib.request.urlopen(f"{REGISTRY}/v0/servers/{name}/versions", timeout=30) as r:
            servers = json.load(r).get("servers", [])
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
        servers = []
    latest = next(
        (s["server"]["version"] for s in servers
         if s.get("_meta", {}).get("io.modelcontextprotocol.registry/official", {}).get("isLatest")),
        None,
    )
    return published, latest


def main(argv):
    if argv[1] == "--fetch":
        local = json.load(open(argv[2], encoding="utf-8"))
        try:
            published, latest = fetch(local)
        except (urllib.error.URLError, OSError, ValueError) as e:
            print(f"реестр MCP недоступен: {e}", file=sys.stderr)
            sys.exit(EXIT_NETWORK)
        print(plan(local, published, latest))
        return
    local = json.load(open(argv[1], encoding="utf-8"))
    published = None
    if len(argv) > 2 and argv[2]:
        try:
            published = json.load(open(argv[2], encoding="utf-8"))
        except (FileNotFoundError, ValueError):
            published = None
    latest = argv[3] if len(argv) > 3 and argv[3] else None
    print(plan(local, published, latest))


if __name__ == "__main__":
    main(sys.argv)
