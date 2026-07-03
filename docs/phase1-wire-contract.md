# Фаза 1 — контракт провода Rust↔Next (git-ядро первым)

Решения (зафиксированы с пользователем 2026-07-03):
- **Транспорт: Connect** (connectrpc.com) — protobuf-контракт + кодоген (типы не разъезжаются
  между Rust и TS), вызовы по HTTP (есть JSON-режим, курлится), без Envoy. Позже при желании —
  чистый gRPC/tonic для тяжёлого стриминга.
- **Порядок переезда: git-ядро ПЕРВЫМ** (как GitLab Gitaly). Домен (issues/curation/…) пока в
  Next+Postgres, переезжает потом. Порты-адаптеры позволяют флипать по одному.
- Прецедент: **GitLab = Rails + Gitaly(Go) по gRPC** для git; git наружу у всех = smart-HTTP+SSH.

## Что сделано в Фазе 1 (git-seam)

- **Порт `GitCore`** (`@/core` ports.ts) — высокоуровневый, под провод (Gitaly-стиль):
  `infoRefsUploadPack / infoRefsReceivePack / uploadPack / receivePack / bundle`.
  Сервис резолвит owner/slug → repo, лочит и проецирует `list.json`→версию ВНУТРИ.
- **`proto/git.proto`** — контракт `service GitCore` (Connect/gRPC). Соответствует порту 1:1.
- **In-process реализация** `features/git/core.inproc.ts` — поверх низкоуровневого `GitStore`
  (shell→git). Роут `[...git]` и `repo.bundle` зависят ТОЛЬКО от порта `GitCore`.
- **Feature-flag** `features/git/core.ts`: `SETFORK_CORE_URL` пусто → inproc; задан → remote
  (Connect→Rust, заглушка до Фазы 2). Переключение backend'а без правки роутов.
- Проверено e2e: clone/pull/push/bundle через `GitCore.inproc` (push создаёт версию).

```
git-клиент ──smart-HTTP──▶ Next [...git] route (auth) ──port GitCore──▶ inproc (сейчас)
                                                                     └──▶ remote Connect ──▶ Rust git-core (Фаза 2)
```

## Фаза 2 — что делать дальше (Rust git-ядро)

1. **Создать Rust-репо** (реком. сосед `C:\Users\Mike\Projects\setfork-core`): `tonic`/`connect` +
   `sqlx` (та же Postgres) + `gix` (read: upload-pack) + `git2`/libgit2 (write: receive-pack).
2. **Реализовать `service GitCore`** из `proto/git.proto`: персистентные bare-репо (модель
   `GIT_DATA_DIR`), `InfoRefs*`, `UploadPack`, `ReceivePack` (+ проекция list.json→версия через
   запись в Postgres), `CreateBundle`, pre-receive валидация, детерминированные SHA (совпадают с TS).
3. **Сгенерировать TS-клиент** (Connect-ES: `buf` + `protoc-gen-es`/`protoc-gen-connect-es`) из
   `proto/git.proto`; реализовать `gitCoreRemote` в `features/git/core.ts` поверх клиента,
   `baseUrl = SETFORK_CORE_URL`.
4. **Флипнуть флаг** `SETFORK_CORE_URL=...` и **golden-сверить** с inproc (те же байты
   advertisement/packfile; тот же SHA; push создаёт ту же версию).
5. Домен-порты (ListStore/Curation/Collab/…) — по тому же паттерну, после git-ядра.

## Prod-заметки
- `proto/git.proto` — общий контракт; в Фазе 2 копия/submodule в Rust-репо (или общий proto-пакет).
- git наружу остаётся smart-HTTP (Next-BFF как Workhorse, либо Rust отдаёт `/*.git` напрямую —
  решаем в Фазе 3, см. rust-core-plan.md).
