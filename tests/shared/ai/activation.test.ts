import { describe, expect, it } from 'vitest'
import { stageAfterWork, stageFor, workQueue, DORMANT_AFTER_DAYS, IDLE_AFTER_DAYS, type Candidate } from '@/shared/ai/activation'

// Политика активации: кто работает на этом такте. Тесты держат два правила, ради которых она и
// написана: работа идёт ТЕМ, ПО КОМУ НЕТ ОСНОВАНИЙ (иначе скоркарт никогда не наполнится), и
// сон — не билет в один конец (спящий возвращается, когда его ремесло больше некому закрыть).

const c = (over: Partial<Candidate> & { id: string }): Candidate => ({
  domains: ['кулинария'],
  lifecycle: 'active',
  attempts: 5,
  daysSinceWork: 1,
  ...over,
})

describe('очередь работы', () => {
  it('без оснований — первым, даже если он «свежий»', () => {
    const q = workQueue([c({ id: 'опытный', attempts: 20, daysSinceWork: 30 }), c({ id: 'новый', attempts: 0, daysSinceWork: null })])
    expect(q[0].id).toBe('новый')
    expect(q[0].why).toContain('нет оснований')
  })

  it('при равном отсутствии оснований порядок воспроизводим, а не «как повезло»', () => {
    const one = workQueue([c({ id: 'б', attempts: 0, daysSinceWork: null }), c({ id: 'а', attempts: 0, daysSinceWork: null })])
    const two = workQueue([c({ id: 'а', attempts: 0, daysSinceWork: null }), c({ id: 'б', attempts: 0, daysSinceWork: null })])
    expect(one.map((x) => x.id)).toEqual(two.map((x) => x.id))
  })

  it('дальше — у кого меньше подтверждений', () => {
    const q = workQueue([c({ id: 'много', attempts: 30 }), c({ id: 'мало', attempts: 3 }), c({ id: 'средне', attempts: 10 })])
    expect(q.map((x) => x.id)).toEqual(['мало', 'средне', 'много'])
  })

  it('при равных попытках — кто дольше не работал', () => {
    const q = workQueue([c({ id: 'вчера', daysSinceWork: 1 }), c({ id: 'месяц', daysSinceWork: 30 })])
    expect(q[0].id).toBe('месяц')
  })

  it('архивные не участвуют вовсе', () => {
    const q = workQueue([c({ id: 'в-архиве', lifecycle: 'archived', attempts: 0 }), c({ id: 'живой' })])
    expect(q.map((x) => x.id)).toEqual(['живой'])
  })

  it('спящие не берут работу, когда есть бодрые', () => {
    const q = workQueue([c({ id: 'спящий', lifecycle: 'dormant', attempts: 0 }), c({ id: 'бодрый', attempts: 50 })])
    expect(q.map((x) => x.id)).toEqual(['бодрый'])
  })

  it('спящий БУДИТСЯ, если его ремесло больше некому закрыть — сон не билет в один конец', () => {
    const q = workQueue(
      [c({ id: 'спящий-повар', lifecycle: 'dormant', domains: ['кулинария'] }), c({ id: 'бодрый-кодер', domains: ['devops'] })],
      'кулинария',
    )
    expect(q[0].id).toBe('спящий-повар')
    expect(q[0].why).toContain('разбужен')
  })

  it('фильтр по ремеслу отбрасывает чужие домены', () => {
    const q = workQueue([c({ id: 'повар', domains: ['кулинария'] }), c({ id: 'кодер', domains: ['devops'] })], 'devops')
    expect(q.map((x) => x.id)).toEqual(['кодер'])
  })

  it('пустой вход — пустая очередь, а не исключение', () => {
    expect(workQueue([])).toEqual([])
  })
})

describe('стадии по бездействию', () => {
  it('работал недавно — активен', () => {
    expect(stageFor({ lifecycle: 'active', daysSinceWork: 3 })).toBe('active')
  })

  it(`без работы ${IDLE_AFTER_DAYS}+ дней — под риском (стадия вмешательства, а не сон)`, () => {
    expect(stageFor({ lifecycle: 'active', daysSinceWork: IDLE_AFTER_DAYS })).toBe('idle')
  })

  it(`без работы ${DORMANT_AFTER_DAYS}+ дней — спит`, () => {
    expect(stageFor({ lifecycle: 'idle', daysSinceWork: DORMANT_AFTER_DAYS })).toBe('dormant')
  })

  it('ни одной работы — сразу под риском, а не «активен»: активность без работы это фикция', () => {
    expect(stageFor({ lifecycle: 'active', daysSinceWork: null })).toBe('idle')
  })

  it('спящий без работы спящим и остаётся', () => {
    expect(stageFor({ lifecycle: 'dormant', daysSinceWork: null })).toBe('dormant')
  })

  it('из архива код не поднимает — только человек', () => {
    expect(stageFor({ lifecycle: 'archived', daysSinceWork: 0 })).toBe('archived')
    expect(stageAfterWork('archived')).toBe('archived')
  })

  it('получил работу — снова активен', () => {
    expect(stageAfterWork('dormant')).toBe('active')
    expect(stageAfterWork('idle')).toBe('active')
  })
})
