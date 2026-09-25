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

Вход: путь к server.json и ответ реестра на GET /v0/servers/{name}/versions/{version} —
файлом (пустой путь или несуществующий файл = 404). Выход: слово в stdout, код 0; отказ — код 1.
"""
import json
import sys

META = "io.modelcontextprotocol.registry/publisher-provided"


def surface(doc):
    return (doc.get("_meta") or {}).get(META, {}).get("surface")


def plan(local, published):
    if published is None:
        return "publish"
    record = published.get("server", published)
    if surface(record) == surface(local):
        return "skip"
    raise SystemExit(
        f"реестр уже содержит {local['name']} {local['version']} с другой поверхностью MCP: "
        "подними version в server.json (версии в реестре неизменяемы)"
    )


def main(argv):
    local = json.load(open(argv[1], encoding="utf-8"))
    published = None
    if len(argv) > 2 and argv[2]:
        try:
            published = json.load(open(argv[2], encoding="utf-8"))
        except FileNotFoundError:
            published = None
    print(plan(local, published))


if __name__ == "__main__":
    main(sys.argv)
