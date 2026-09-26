/**
 * ПРЕДЕЛЫ СКИЛЛА — от того, что его УСТАНОВИТ, а не от того, что мы можем хранить.
 *
 * Скилл ставят `npx skills add …/skill.tar.gz` (vercel-labs/skills). Установщик скачивает
 * архив не больше `DEFAULT_DOWNLOAD_MAX_BYTES` = 10 MiB (сверено по dist/cli.mjs 1.7.0,
 * 26.09.2026). Скилл крупнее хранился бы у нас, но не ставился бы рекомендуемой командой.
 * Двоичные файлы (картинки, PDF) почти не сжимаются, поэтому их предел выводится вычитанием.
 */
export const SKILL_INSTALL_DOWNLOAD_MAX_BYTES = 10 * 1024 * 1024

/** Текст скилла (`scripts/`, `references/`, текстовые `assets/`) — копия предела ядра
 *  (setfork-core `serialize.rs`: AUTHORED_MAX_BYTES). Решает ядро; копия — для раннего отказа. */
export const SKILL_TEXT_MAX_BYTES = 1024 * 1024

/** Запас на `SKILL.md` (собирается из блоков) и заголовки tar (512 байт на запись). */
const SKILL_MD_HEADROOM_BYTES = 1024 * 1024

/** Двоичные файлы скилла вместе (и каждый) — чтобы архив уложился в предел установщика. */
export const SKILL_ASSETS_MAX_BYTES = SKILL_INSTALL_DOWNLOAD_MAX_BYTES - SKILL_TEXT_MAX_BYTES - SKILL_MD_HEADROOM_BYTES
