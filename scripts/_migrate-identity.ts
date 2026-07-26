// ВРЕМЕННО (до мержа ветки): все колонки ветки feat/gnome-identity одним идемпотентным
// проходом. Нужен потому, что дев-БД общая: db:push из копии без этих колонок их удаляет.
import { sql } from 'drizzle-orm'
import { db } from '../src/shared/db'

const STEPS: [string, string][] = [
  ['users.account_type', `alter table users add column if not exists account_type text not null default 'human'`],
  ['users.profession', `alter table users add column if not exists profession text`],
  ['council_experts.profession_en', `alter table council_experts add column if not exists profession_en text not null default ''`],
  ['council_experts.profession_ru', `alter table council_experts add column if not exists profession_ru text not null default ''`],
  ['council_experts.user_id', `alter table council_experts add column if not exists user_id uuid references users(id) on delete set null`],
  ['council_experts.lifecycle', `alter table council_experts add column if not exists lifecycle text not null default 'active'`],
  ['council_experts.org_role', `alter table council_experts add column if not exists org_role text not null default 'expert'`],
  ['council_experts.tier', `alter table council_experts add column if not exists tier text not null default ''`],
  ['council_experts.dreams', `alter table council_experts add column if not exists dreams text not null default ''`],
  ['backfill профессий (en)', `update council_experts set profession_en = name_en where profession_en = ''`],
  ['backfill профессий (ru)', `update council_experts set profession_ru = name_ru where profession_ru = ''`],
  ['зонтики → начальники гильдий', `update council_experts set org_role = 'chief' where id in ('coder','devops') and org_role = 'expert'`],
  ['садовник → служебный', `update users set account_type='agent', profession=coalesce(nullif(profession,''),'Gardener'), location=coalesce(nullif(location,''),'Niðavellir') where handle='gardener'`],
]

async function main() {
  for (const [name, q] of STEPS) {
    try {
      await db.execute(sql.raw(q))
      console.log('OK   ' + name)
    } catch (e) {
      console.log(`FAIL ${name}: ${e instanceof Error ? e.message : e}`)
      process.exitCode = 1
    }
  }
  process.exit(process.exitCode ?? 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
