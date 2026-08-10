import { toolKit } from './kit'
import { registerReads } from './reads'
import { registerGnomes } from './gnomes'
import { registerLists } from './lists'
import { registerSuggestions } from './suggestions'
import { registerSources } from './sources'
import { registerRuns } from './runs'

export { serverOptions } from './server-info'

/**
 * СБОРКА РЕЕСТРА ИНСТРУМЕНТОВ MCP.
 *
 * Один вызов на домен. Новый инструмент добавляется в файл своего домена, а не в
 * общий список на семьсот строк — и правка одного домена не задевает соседние.
 * Способ регистрации (скоуп, подсказки агенту) один на всех и живёт в `kit`.
 */
export function registerTools(server: Parameters<typeof toolKit>[0]) {
  const kit = toolKit(server)
  registerReads(kit)
  registerGnomes(kit)
  registerLists(kit)
  registerSuggestions(kit)
  registerSources(kit)
  registerRuns(kit)
}
