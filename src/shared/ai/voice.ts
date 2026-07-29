/**
 * Голоса гномов — этап «характер без LLM» плана мастерской
 * (setfork-hq/research/2026-07-21-gnome-workshop.md): статичные наборы реплик по
 * (who, kind), выбор — детерминированный хэш от seed. 0 токенов, 0 задержки.
 *
 * Реплики живут ТОЛЬКО в ленте беседы (generation_messages) и НИКОГДА не
 * попадают в рабочие промпты — спотлайтинг совета не трогаем.
 *
 * Файл сознательно чистый (без server-only и БД): юнит-тестируется как есть.
 * Лёгкие «стычки» (повар ворчит на новатора, критик поддевает всех) прописаны
 * строками у персонажей — атмосфера мастерской без единого вызова модели.
 */

export type VoiceKind =
  | 'plan-single'
  | 'plan-council'
  | 'clarify'
  | 'summon'
  | 'seek'
  | 'draft'
  | 'innovate'
  | 'critique'
  | 'synth'

interface VoiceSet {
  en: string[]
  ru: string[]
}

/** Плейсхолдеры в строках: {names} — созванные эксперты, {n} — число прецедентов. */
export const VOICE: Record<string, Partial<Record<VoiceKind, VoiceSet>>> = {
  // ── Служебные роли совета ──
  planner: {
    'plan-single': {
      en: ["Simple topic — I've got this, writing right away.", 'No council needed — drafting solo.', 'A quick one: writing without convening the council.'],
      ru: ['Тема простая — сам справлюсь, пишу сразу.', 'Тут совет не нужен — набросаю в одиночку.', 'Быстрое дело: пишу без созыва совета.'],
    },
    'plan-council': {
      en: ["A many-sided topic — calling the council, one gnome won't cut it.", 'Hm, this needs more than one pair of eyes. Convening the council.', 'A task with facets — handing it out to the masters.'],
      ru: ['Тема многогранная — зову совет, один гном тут не вывезет.', 'Хм, тут нужен не один взгляд. Собираю совет.', 'Задача с гранями — раздаю по мастерам.'],
    },
  },
  reporter: {
    clarify: {
      en: [
        'The request is vague — a couple of questions will sharpen it.',
        'Hm, missing details. Let me ask — the list will come out better.',
        'Too many readings of this one. Two questions and we are on track.',
        'I can guess, but guessing makes a worse list. Asking.',
        'A short question now saves a wrong list later.',
        'The answer depends on things you have not said yet — let me ask.',
      ],
      ru: [
        'Запрос размытый — задам пару вопросов, будет точнее.',
        'Хм, деталей не хватает. Спрошу — список выйдет лучше.',
        'Тут несколько прочтений. Два вопроса — и не промахнёмся.',
        'Могу и угадать, но угаданный список выйдет хуже. Спрошу.',
        'Короткий вопрос сейчас дешевле неверного списка потом.',
        'Ответ зависит от того, чего вы ещё не сказали. Уточню.',
      ],
    },
  },
  crier: {
    summon: {
      en: ['Summoning: {names}. To your stations!', 'Invited to the workshop: {names}.', 'Ringing the bell: {names} — to the bench!'],
      ru: ['Созываю: {names}. По местам!', 'В мастерскую приглашаются: {names}.', 'Бью в колокол: {names} — к верстаку!'],
    },
  },
  'seek-lists': {
    seek: {
      en: [
        'Dug through the library: {n} similar lists. Putting them on the table.',
        'The archives turned up {n} similar ones. These will help.',
        '{n} precedents from our own shelves — better than starting blank.',
        'Found {n} lists on neighbouring topics. Taking what fits.',
        'Our library already knows something: {n} relevant lists.',
        '{n} of ours to lean on. The rest we write ourselves.',
      ],
      ru: [
        'Порылся в библиотеке: похожих списков — {n}. Кладу на стол.',
        'В архивах нашлось похожее: {n}. Пригодится.',
        'Прецедентов с наших полок — {n}. Это лучше, чем с чистого листа.',
        'Нашёл {n} списков по соседним темам. Беру, что подходит.',
        'Библиотека кое-что уже знает: {n} подходящих списков.',
        'Опереться есть на что — {n} наших. Остальное напишем сами.',
      ],
    },
  },
  'seek-web': {
    seek: {
      en: [
        'Off to the web for precedents…',
        'Checking how it is done out there…',
        'One query is not a search yet — trying different wordings…',
        'Looking for who has already solved this…',
        'Going outside: our shelves are thin on this one…',
      ],
      ru: [
        'Слетаю в интернет за прецедентами…',
        'Гляну, как это делают снаружи…',
        'Один запрос — ещё не поиск. Пробую разные формулировки…',
        'Ищу, кто уже решал это до нас…',
        'Иду наружу: на наших полках по этой теме пусто…',
      ],
    },
  },
  innovator: {
    innovate: {
      en: ['What if we come at it sideways?.. Let me think.', "Everyone goes straight — I'll find the side door.", "It won't be boring: bringing a couple of bold ideas."],
      ru: ['А если зайти с неожиданной стороны?.. Дайте подумать.', 'Все идут прямо — а я поищу боковую дверь.', 'Скучно не будет: несу пару дерзких идей.'],
    },
  },
  critic: {
    critique: {
      en: ["Well, well, what have we here… I'll find the weak spots.", 'No praise from me — my job is finding holes.', "The innovator got carried away again — let's see what survives."],
      ru: ['Так-так, что тут у нас… Сейчас найду слабые места.', 'Хвалить не буду — моя работа искать дыры.', 'Новатор опять размахнулся — проверю, что из этого выживет.'],
    },
  },
  elder: {
    synth: {
      en: ['Quiet, masters. Taking the best of each — merging into one.', 'A fine argument — now my word. Synthesizing the list.', 'Folding the drafts into one whole — the boldest bits stay.'],
      ru: ['Тихо, мастера. Беру лучшее у каждого — свожу воедино.', 'Спорили славно — теперь моё слово. Свожу список.', 'Собираю из черновиков одно целое — самое смелое сохраню.'],
    },
  },
  // ── Эксперты (id из roster SEED; свой кастомный эксперт без голоса падает на общий фолбэк) ──
  devops: {
    draft: {
      en: ['Right — where is the rollback if it all burns?.. Drafting.', 'No health-check, no deal. Writing my take.', 'Automating the toil right into the list — running this by hand is a sin.'],
      ru: ['Так, где тут откат, если всё сгорит?.. Набрасываю.', 'Без хелсчека не приму. Пишу свой вариант.', 'Автоматизирую рутину прямо в списке — руками такое гонять грех.'],
    },
  },
  coder: {
    draft: {
      en: ['Hm, and the edge cases? Noting them in my draft.', 'Splitting into small reviewable steps — like commits.', 'Happy path first, then what breaks. Drafting.'],
      ru: ['Хм, а что на граничных случаях? Учту в черновике.', 'Разбиваю на маленькие проверяемые шаги — как коммиты.', 'Сначала happy path, потом что может сломаться. Пишу.'],
    },
  },
  chef: {
    draft: {
      en: ['Mise en place first, then heat. Writing it down to the gram.', '«To taste» will not pass — numbers only. Drafting.', 'Now, what waits and what burns… laying it out in order.', 'The innovator and his experiments again… Mine will be exact to the gram.'],
      ru: ['Сначала mise en place, потом огонь. Записываю до грамма.', '«По вкусу» не приму — только цифры. Набрасываю.', 'Так, что здесь ждёт, а что горит… раскладываю по порядку.', 'Опять новатор со своими экспериментами… У меня всё будет по граммам.'],
    },
  },
  traveler: {
    draft: {
      en: ['Counting back from departure day: visas, vaccines, tickets…', 'Documents get checked against the official source, not memory. Drafting.', 'Adding a fallback for the most likely failure.'],
      ru: ['Считаю от даты выезда назад: визы, прививки, билеты…', 'Документы сверяем с официальным источником, не по памяти. Пишу.', 'Закладываю запасной план на самый вероятный облом.'],
    },
  },
  coach: {
    draft: {
      en: ['Screening before load — not the other way round. Drafting.', 'Progression one parameter at a time, no heroics.', 'I will flag the form errors that lead to injury.'],
      ru: ['Сначала скрининг, потом нагрузка — не наоборот. Пишу.', 'Прогрессия по одному параметру за раз, без героизма.', 'Отмечу ошибки техники, которые ведут к травме.'],
    },
  },
  scholar: {
    draft: {
      en: ['One query is not a search. Trying different phrasings…', 'Weighing sources against THIS question, not the brand.', 'Adding a self-check step — proof the reader actually got it.'],
      ru: ['Один запрос — ещё не поиск. Пробую разные формулировки…', 'Источники взвешиваю под ЭТОТ вопрос, а не по бренду.', 'Добавлю шаг самопроверки — чтобы было чем доказать, что понял.'],
    },
  },
  hoarder: {
    draft: {
      en: ['Ooh! I happen to have a couple of links for exactly this…', 'Every find goes through CRAAP, do not worry.', 'I will say not just WHAT to grab, but the price and the catch.'],
      ru: ['О! У меня как раз завалялась пара ссылок под это…', 'Каждую находку прогоняю через CRAAP, не переживайте.', 'Скажу не только ЧТО взять, но и почём, и с каким подвохом.'],
    },
  },
  generalist: {
    draft: {
      en: ['First classify the task, then pick the method.', 'Understand → plan → do → look back. We keep the last one.', 'Shaping it like a working checklist: short blocks, pause points.'],
      ru: ['Сначала пойму, какого сорта задача, потом выберу метод.', 'Понять → спланировать → сделать → оглянуться. Последнее не пропустим.', 'Соберу как рабочий чеклист: короткие блоки, точки паузы.'],
    },
  },
}

/** FNV-1a: детерминированный «рандом». Math.random в совете запрещён не зря —
 *  одна и та же попытка генерации должна давать одну и ту же реплику. */
function fnv(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Реплика персонажа для события. null — у (who, kind) голоса нет, вызывающий
 * подставляет свой нейтральный текст (кастомные эксперты из админки, новые kinds).
 * seed один на виток совета: реплики попытки стабильны, между попытками — разные;
 * who в хэше разводит персонажей одного витка по разным строкам.
 */
export function voiceLine(who: string, kind: VoiceKind, lang: 'en' | 'ru', seed: string, vars: Record<string, string> = {}): string | null {
  const set = VOICE[who]?.[kind]
  const arr = lang === 'ru' ? set?.ru : set?.en
  if (!arr?.length) return null
  let line = arr[fnv(`${who}:${kind}:${seed}`) % arr.length]
  for (const [k, v] of Object.entries(vars)) line = line.replaceAll(`{${k}}`, v)
  return line
}
