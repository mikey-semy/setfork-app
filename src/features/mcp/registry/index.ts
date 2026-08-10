import { toolKit } from './kit'
import { registerReads } from './reads'
import { registerGnomes } from './gnomes'
import { registerLists } from './lists'
import { registerSuggestions } from './suggestions'
import { registerChecks } from './checks'
import { registerSources } from './sources'
import { registerRuns } from './runs'

export { serverOptions } from './server-info'

/**
 * СБОРКА РЕЕСТРА ИНСТРУМЕНТОВ MCP.
 *
 * Один вызов на домен. Новый инструмент добавляется в файл своего домена, а не в
 * общий список на семьсот строк — и правка одного домена не задевает соседние.
 * Способ регистрации (скоуп, подсказки агенту) один на всех и живёт в `kit`.
 *
 * Список регистраторов живёт ЗДЕСЬ, а не в маршруте: иначе есть способ потерять
 * инструменты молча — забыл дописать вызов рядом с семью соседними, и клиент
 * просто не увидит части набора. `registry.test.ts` зовёт эту же функцию и
 * сверяет состав поимённо, поэтому пропажа падает в CI, а не у агента.
 */
export function registerTools(server: Parameters<typeof toolKit>[0]) {
  const kit = toolKit(server)
  registerReads(kit)
  registerGnomes(kit)
  registerLists(kit)
  registerSuggestions(kit)
  registerChecks(kit)
  registerSources(kit)
  registerRuns(kit)
}
