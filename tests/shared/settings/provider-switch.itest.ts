import { sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { appSettings, db } from '@/shared/db'
import { getModelSettings, getProviderConfigFor } from '@/shared/settings/ai'
import { resetTables } from '../../helpers/reset-db'

// БАГ 2026-07-27: в админке каталог моделей строился для СОХРАНЁННОГО провайдера, а
// переключатель провайдера жил в клиентском состоянии. Выбор другого провайдера не менял
// список, а сохранение записывало модель СТАРОГО провайдера в неймспейс НОВОГО — настройка
// ломалась молча («выбрал другую модель, ничего не происходит»).
//
// Здесь проверяется фундамент починки: конфиг и модельные настройки берутся для УКАЗАННОГО
// провайдера, а не для активного, и ключи при этом остаются каждый своим.

const set = async (key: string, value: string) => {
  await db.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } })
}

beforeAll(async () => {
  await resetTables(sql`${appSettings}`, { restartIdentity: false, cascade: false })
})

beforeEach(async () => {
  await db.delete(appSettings)
})

describe('конфиг указанного провайдера', () => {
  it('берётся ключ ИМЕННО этого провайдера, а не активного', async () => {
    await set('ai.provider', 'yandex')
    await set('ai.api_key', 'sk-or-openrouter')
    await set('ai.yandex_api_key', 'ya-key')
    await set('ai.yandex_folder_id', 'folder-1')

    const or = await getProviderConfigFor('openrouter')
    const ya = await getProviderConfigFor('yandex')
    expect(or).toMatchObject({ provider: 'openrouter', apiKey: 'sk-or-openrouter' })
    expect(ya).toMatchObject({ provider: 'yandex', apiKey: 'ya-key' })
  })

  it('нет ключа у выбранного провайдера — null, а не чужой конфиг', async () => {
    await set('ai.provider', 'openrouter')
    await set('ai.api_key', 'sk-or-openrouter')
    expect(await getProviderConfigFor('gigachat')).toBeNull()
    expect(await getProviderConfigFor('selectel')).toBeNull()
  })

  it('Яндексу нужны И ключ, И папка — половины недостаточно', async () => {
    await set('ai.yandex_api_key', 'ya-key')
    expect(await getProviderConfigFor('yandex')).toBeNull()
    await set('ai.yandex_folder_id', 'folder-1')
    expect(await getProviderConfigFor('yandex')).not.toBeNull()
  })
})

describe('модельные настройки указанного провайдера', () => {
  it('у каждого провайдера свои — переключение не тащит чужую модель', async () => {
    await set('ai.openrouter.chat_model', 'openai/gpt-4o-mini')
    await set('ai.yandex.chat_model', 'gpt://folder/yandexgpt-5.1/latest')
    expect((await getModelSettings('openrouter')).chatModel).toBe('openai/gpt-4o-mini')
    expect((await getModelSettings('yandex')).chatModel).toBe('gpt://folder/yandexgpt-5.1/latest')
  })

  it('у провайдера без своей записи — ЕГО дефолт, а не модель соседа', async () => {
    await set('ai.openrouter.chat_model', 'openai/gpt-4o-mini')
    await set('ai.yandex_folder_id', 'folder-1')
    const ya = await getModelSettings('yandex')
    expect(ya.chatModel).toContain('yandexgpt')
    expect(ya.chatModel).not.toBe('openai/gpt-4o-mini')
  })

  it('легаси-ключ ai.chat_model — фолбэк ТОЛЬКО для openrouter', async () => {
    await set('ai.chat_model', 'openai/legacy-model')
    expect((await getModelSettings('openrouter')).chatModel).toBe('openai/legacy-model')
    await set('ai.yandex_folder_id', 'folder-1')
    expect((await getModelSettings('yandex')).chatModel).not.toBe('openai/legacy-model')
  })
})
