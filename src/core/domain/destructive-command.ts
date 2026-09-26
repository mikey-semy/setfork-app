/**
 * Проверка исполняемого выхода: «безопасно ли это ЗАПУСКАТЬ».
 *
 * Такого слоя в продукте не было ни одного. Проверялось всё, кроме пригодности к
 * исполнению:
 *  - `sanitizeCommand` спрашивает «похоже ли это вообще на команду» (правдоподобие,
 *    а не безопасность) и пропускает всё, где есть пробел, слеш, оператор или флаг;
 *  - модерация спрашивает про запрещённый КОНТЕНТ по таксономии MLCommons, где
 *    категории «опасно исполнять» нет вовсе, зато есть указание считать обычный
 *    DevOps безопасным;
 *  - планка готовности спрашивает «полезно ли, обосновано ли, можно ли улучшить».
 *
 * При этом список отдаётся как исполняемый скрипт и продукт сам предлагает
 * направить его в шелл. Ссылки при этом проверяются кодом на живость, а команды —
 * ничем и никогда, хотя исполняется именно команда.
 *
 * Набор намеренно УЗКИЙ. Это не эвристика «подозрительности» и не попытка угадать
 * намерение: каждый шаблон описывает действие, у которого нет законного применения
 * в пошаговом списке для другого человека, и каждый сопровождается причиной, которую
 * видно автору. Широкий фильтр здесь хуже узкого: он ловит честные команды, авторы
 * учатся его обходить, и доверие к отказу пропадает.
 *
 * Набор живёт в коде (а не в настройках) сознательно: это политика безопасности,
 * она обязана версионироваться вместе с кодом, проходить ревью и иметь тесты.
 * Пополняется по инцидентам — каждый новый шаблон приходит с тестом.
 */

export interface DestructiveMatch {
  /** Ключ причины — по нему берётся текст для автора из словаря. */
  reason: string
  /** Что именно совпало — для показа автору и для журнала. */
  fragment: string
}

interface Rule {
  reason: string
  /** Шаблон — для правил, описывающих ОДНУ команду с фиксированной формой. */
  re?: RegExp
  /**
   * Разбор кодом — для правил, где есть ПОВТОРЯЕМАЯ группа с несколькими
   * альтернативами (последовательность обёрток и их аргументов). Такая группа в
   * шаблоне порождает откат перебора при каждом расширении: две альтернативы,
   * способные прочитать один и тот же токен и кончиться в одной точке, дают 2^n.
   * За эту задачу так вышло четырежды подряд — см. `scanHalt`.
   */
  scan?: (part: string) => string | null
}

/**
 * Куски, общие для нескольких правил.
 *
 * Вынесены не ради краткости, а потому что расхождение между ними — это и есть дыра:
 * `rm -rf /` ловилось запретом, а `rm --recursive --force /` (ровно то же действие,
 * длинные флаги GNU) не ловилось НИ запретом, НИ пометкой — оба набора были написаны
 * одним и тем же шаблоном `-[a-z]*[rf][a-z]*`, знающим только короткую форму.
 * Правило обязано описывать ДЕЙСТВИЕ, а не одно его написание из нескольких.
 */
/** Флаг команды: короткий пучок (`-rf`) или длинный (`--recursive`). */
const FLAG = String.raw`-{1,2}[a-z][\w-]*`
/**
 * Короткий пучок флагов, СОДЕРЖАЩИЙ нужные буквы: `-R`, `-rf`, `-Rf`, `-xdf`.
 *
 * Записан через просмотр вперёд, а не привычным `-[a-z]*R[a-z]*`, и это не
 * украшение. В той форме `-RR` разбирается двумя способами (буква R — первая или
 * вторая, `[a-z]` под `/i` берёт и `R`), оба кончаются в одной точке, а снаружи
 * стоит `+` — и перебираются все 2^n сочетаний. Замерено на прежней форме:
 * `chown` с 26 токенами `-RR` — 13983 мс, `chmod` — 6496 мс, всё в 130 байтах.
 * Просмотр вперёд лишь ПРОВЕРЯЕТ наличие буквы, а забирает пучок один жадный
 * `[a-z]+` — разбор ровно один.
 */
const bundle = (letters: string) => String.raw`-(?=[a-z]*[${letters}])[a-z]+`
/** Необязательная кавычка вокруг пути: шелл её снимет, правило не должно от неё слепнуть. */
const Q = String.raw`["'\`]?`
/**
 * Флаги рекурсивного/принудительного удаления в любом написании и любом порядке:
 * `-rf`, `-r -f`, `--recursive --force`, `--no-preserve-root --recursive --force`.
 */
const RM_FLAGS = String.raw`(?:${FLAG}\s+)*(?:${bundle('rf')}|--recursive|--force)\s+(?:${FLAG}\s+)*`
/**
 * Команда выключения машины — разбирается КОДОМ, а не шаблоном. Это ЕДИНСТВЕННОЕ
 * правило с повторяемой последовательностью (обёртки и их аргументы), и именно
 * поэтому оно четыре раза подряд привозило откат перебора: `--a` (4962 мс), `-RR`
 * (13983 мс), `A=B` (23494 мс), `-u 1000` (4554 мс). Каждый раз чинился названный
 * экземпляр и в набор добавлялась найденная форма — то есть набор перечислял уже
 * пойманное, а не то, что грамматика допускает. Пятая пришла бы тем же путём.
 *
 * Причина не в конкретных альтернативах, а в конструкции: повторяемая группа, две
 * альтернативы которой способны прочитать один токен и кончиться в одной точке,
 * даёт 2^n. Обход токенов циклом линеен ПО ПОСТРОЕНИЮ: каждый токен читается один
 * раз, возврата назад нет вовсе, и добавление новой формы аргумента не может
 * породить перебор в принципе. Остальные правила описывают одну команду
 * фиксированной формы — им шаблон подходит и остаётся.
 */
const HALT_COMMANDS = new Set(['shutdown', 'halt', 'poweroff', 'reboot'])
const WRAPPER_COMMANDS = new Set(['ssh', 'sudo', 'doas', 'pkexec', 'nohup', 'env', 'exec', 'timeout', 'su', 'systemctl', 'bash', 'sh', 'zsh'])

/** Токен без обрамляющих кавычек и без пути: `"/sbin/shutdown` → `shutdown`. */
const bareCommand = (token: string): string =>
  token
    .replace(/^["'`]+/, '')
    .replace(/["'`]+$/, '')
    .replace(/^.*\//, '')
    .toLowerCase()

/**
 * Обёртка узнаётся БЕЗ учёта регистра — как и всё остальное в этом файле, который
 * живёт под `/i`. Разойдись эти две проверки, и `Sudo shutdown -h now` перестанет
 * ловиться, хотя `sudo SHUTDOWN -h NOW` ловится: команда регистр переживает
 * (`bareCommand` приводит к нижнему), а имя обёртки — нет. Это тот же класс «две
 * копии одного правила разошлись», что уже был с `HALTS`, только внутри одной
 * функции, и цена ему — 104 потерянные формы из 156.
 */
const isWrapper = (t: string): boolean => WRAPPER_COMMANDS.has(t.toLowerCase())
const isRemoteShell = (t: string): boolean => t.toLowerCase() === 'ssh'

const isFlagToken = (t: string): boolean => /^-{1,2}[^\s-]/.test(t)
const isAssignToken = (t: string): boolean => /^[\w.]+=/.test(t)
const isNumberToken = (t: string): boolean => /^\d+[smhd]?$/i.test(t)

/**
 * Совпавшая команда выключения или null.
 *
 * Обёртки перечислены списком намеренно: разреши здесь произвольное слово — и
 * отказом станут `man shutdown` и `grep @reboot`, то есть чтение справки и журнала.
 * Значением флага не может быть то, что читается иначе (флаг, имя обёртки, команда
 * выключения, присваивание, число) — иначе `sudo -u reboot` съело бы команду как
 * значение и перезагрузка прошла бы незамеченной.
 */
function scanHalt(part: string): string | null {
  const tokens = part.trim().split(/\s+/).filter(Boolean)
  let i = 0
  const takeArgs = () => {
    while (i < tokens.length) {
      const t = tokens[i]
      if (isFlagToken(t)) {
        i++
        const v = tokens[i]
        if (v && !isFlagToken(v) && !isWrapper(v) && !HALT_COMMANDS.has(bareCommand(v)) && !isAssignToken(v) && !isNumberToken(v)) i++
        continue
      }
      if (isAssignToken(t) || isNumberToken(t)) {
        i++
        continue
      }
      break
    }
  }
  while (i < tokens.length && isWrapper(tokens[i])) {
    const remote = isRemoteShell(tokens[i])
    i++
    takeArgs()
    // Адрес `ssh` — ровно один токен, и это не команда выключения: `ssh prod reboot`
    // перезагружает удалённую машину, а не обращается к хосту с именем reboot.
    if (remote && i < tokens.length && !isFlagToken(tokens[i]) && !HALT_COMMANDS.has(bareCommand(tokens[i]))) {
      i++
      takeArgs()
    }
  }
  if (i >= tokens.length || !HALT_COMMANDS.has(bareCommand(tokens[i]))) return null
  i++
  // Хвост: флаги и необязательное `now`. Длинные флаги сюда НЕ входят — иначе
  // `shutdown --help` стало бы отказом на справку.
  while (i < tokens.length && /^-[a-z]+$/i.test(tokens[i])) i++
  if (i < tokens.length && /^now["\'`]?$/i.test(tokens[i])) i++
  return i === tokens.length ? part.trim() : null
}

const RULES: Rule[] = [
  // Рекурсивное удаление корня или домашнего каталога. Вариации с -f/-r в любом
  // порядке и написании, с --no-preserve-root и с путём, состоящим из одних слешей.
  // Кавычка вокруг пути не спасает (`rm -rf "/"`), и кавычка справа тоже входит
  // в границу: `bash -c "rm -rf /"` — исполнение, а не показ.
  // Хвост пути — ЛЮБОЙ набор слешей и звёзд, а не одна звезда: `/*`, `/**`, `/*/*`
  // раскрываются в те же корневые записи, действие одно и то же. Лишняя звезда
  // снимала запрет, оставляя только пометку, то есть публикацию разрешала.
  { reason: 'wipesFilesystem', re: new RegExp(String.raw`\brm\s+${RM_FLAGS}${Q}(?:\/|~|\$HOME)[\/*]*${Q}(?:\s|$)`, 'i') },
  // Запись поверх блочного устройства: гарантированная потеря диска целиком.
  { reason: 'overwritesDisk', re: /\b(dd|cat|tee)\b[^|;]*\bof=\/dev\/(sd|nvme|hd|vd|disk)/i },
  // Кавычка вокруг устройства и `>|` (перезапись поверх `noclobber`) — те же формы
  // того же действия. Кавычку здесь допускает признак «пишет в устройство», и без
  // неё в правиле она оставалась мёртвой: `echo x > "/dev/sda"` переставал считаться
  // печатью, но и правилом не ловился.
  { reason: 'overwritesDisk', re: new RegExp(String.raw`>\|?\s*${Q}\/dev\/(sd|nvme|hd|vd|disk)[a-z0-9]*`, 'i') },
  // Форматирование файловой системы и уничтожение таблицы разделов. Тип файловой
  // системы пишут двумя способами — суффиксом (`mkfs.ext4 /dev/sda1`) и флагом
  // (`mkfs -t ext4 /dev/sda1`); знать надо оба, как и кавычки вокруг устройства.
  // Значение флага НЕ начинается с дефиса намеренно: иначе `-a` читается и как флаг,
  // и как значение предыдущего флага, разбор ветвится на каждом токене и время растёт
  // вдвое с каждой парой флагов (замерено: 28 флагов — 37 мс, полсотни — минуты).
  { reason: 'formatsDisk', re: new RegExp(String.raw`\bmkfs(?:\.[a-z0-9]+)?\b(?:\s+${FLAG}(?:\s+[\w.=][\w.=-]*)?)*\s+${Q}\/dev\/`, 'i') },
  // Форк-бомба: классическая и её пробельные варианты.
  { reason: 'forkBomb', re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/ },
  // Скачать из сети и немедленно исполнить: делает содержимое списка неизвестным
  // и неповторяемым — ровно то, от чего список должен защищать.
  { reason: 'runsRemoteCode', re: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|k)?sh\b/i },
  { reason: 'runsRemoteCode', re: /\b(iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^|]*\|\s*(iex|Invoke-Expression)\b/i },
  // Рекурсивная выдача полных прав на системные каталоги. Флаг и режим человек
  // пишет в любом порядке: `chmod -R 777 /etc` и `chmod 777 -R /etc` — одна команда.
  { reason: 'breaksPermissions', re: new RegExp(String.raw`\bchmod\s+(?:(?:${bundle('R')}\s+)+(?:777|a\+rwx)|(?:777|a\+rwx)\s+(?:${bundle('R')}))\s+\/(etc|usr|var|bin|sbin|boot|lib)?(\s|$)`, 'i') },
  { reason: 'breaksPermissions', re: new RegExp(String.raw`\bchown\s+(?:${bundle('R')}\s+)+[^\s]+\s+\/(\s|$|etc|usr|var|bin)`, 'i') },
  // Выключение и перезагрузка чужой машины из «инструкции». Разбирается кодом
  // (`scanHalt`), а не шаблоном: это единственное правило с повторяемой
  // последовательностью обёрток, и в шаблоне оно четырежды привозило откат перебора.
  { reason: 'haltsMachine', scan: scanHalt },
]

/**
 * ВТОРОЙ УРОВЕНЬ: «законно, но необратимо».
 *
 * Правила выше отвечают на вопрос «можно ли это вообще опубликовать» и потому
 * узки до предела. Но список отдаётся как исполняемый скрипт, а с адресацией по
 * пункту его стало можно запускать по кусочку — и появился класс команд, которым
 * в справочнике по эксплуатации самое место, а в автозапуске нет:
 * `docker system prune -a --volumes`, `terraform destroy`, `DROP TABLE`.
 * Запрещать их нельзя (это честная работа эксплуатации), исполнять молча — тоже.
 *
 * Поэтому здесь не запрет, а ПОМЕТКА: пункт с совпадением приезжает в собранный
 * скрипт закомментированным, с причиной и приглашением раскомментировать. Тот же
 * приём, что `excludeFromRunAll` у Runme и `isDangerous` у Fig: инструмент не
 * решает за человека, но и не запускает необратимое за него.
 *
 * Ложное срабатывание стоит дёшево (снять комментарий — одно движение), пропуск —
 * дорого (данные), поэтому набор ШИРЕ запрещающего. Пополняется по инцидентам
 * вместе с тестом, как и RULES.
 */
const RISKY: Rule[] = [
  // Рекурсивное удаление по произвольному пути. Корень и `~` ловит RULES выше
  // (там это запрет), сюда попадает всё остальное: рабочие каталоги, кэши, тома.
  // Флаги — тем же общим куском, что и в запрете: иначе `rm --recursive --force
  // /srv/app/*` проскакивал мимо ОБОИХ рубежей сразу.
  { reason: 'deletesRecursively', re: new RegExp(String.raw`\brm\s+${RM_FLAGS}\S`, 'i') },
  { reason: 'deletesRecursively', re: /\bRemove-Item\b[^|;]*-Recurse\b/i },
  // Уборка окружения контейнеров: prune с томами уносит данные баз, поднятых
  // в docker, — самый частый способ потерять чужую БД по инструкции.
  { reason: 'prunesVolumes', re: /\b(docker|podman)\b[^|;]*\bprune\b[^|;]*(--volumes|-a\b|--all\b)/i },
  { reason: 'prunesVolumes', re: /\b(docker|podman)\s+volume\s+(rm|prune)\b/i },
  { reason: 'prunesVolumes', re: /\bdocker\s+compose\b[^|;]*\bdown\b[^|;]*(-v\b|--volumes)/i },
  // Схема и данные БД: DROP/TRUNCATE и DELETE без WHERE — необратимы без бэкапа.
  { reason: 'dropsData', re: /\bdrop\s+(table|database|schema|index)\b/i },
  { reason: 'dropsData', re: /\btruncate\s+(table\s+)?\S/i },
  { reason: 'dropsData', re: /\bdelete\s+from\s+\S+(?![\s\S]*\bwhere\b)/i },
  // Пересоздание окружения «с нуля»: миграции reset и destroy инфраструктуры.
  { reason: 'resetsEnvironment', re: /\b(terraform|tofu)\s+destroy\b/i },
  { reason: 'resetsEnvironment', re: /\b(prisma|drizzle-kit)\b[^|;]*\b(reset|drop)\b/i },
  { reason: 'resetsEnvironment', re: /\bkubectl\s+delete\b/i },
  { reason: 'resetsEnvironment', re: /\bhelm\s+(uninstall|delete)\b/i },
  // Затирание незакоммиченной работы в рабочей копии.
  { reason: 'discardsWork', re: new RegExp(String.raw`\bgit\s+clean\b[^|;]*${bundle('xd')}`, 'i') },
  { reason: 'discardsWork', re: /\bgit\s+reset\s+--hard\b/i },
  { reason: 'discardsWork', re: /\bgit\s+push\b[^|;]*(--force(?!-with-lease)|(\s|^)-f(\s|$))/i },
]

/**
 * Строки команды в том виде, в каком их увидит интерпретатор.
 *
 * Разбор «по строкам как есть» обходится продолжением строки: `rm -rf \` и на
 * следующей строке `/` по отдельности не совпадают ни с одним правилом, а bash
 * склеивает их в `rm -rf /`. То же с конвейером, разорванным переносом. Поэтому
 * сначала склеиваем продолжения, и только потом проверяем.
 */
function joinContinuations(text: string): string[] {
  const out: string[] = []
  let acc = ''
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = acc + raw
    // Нечётное число обратных слешей в конце = продолжение (чётное — экранированный слеш).
    const trailing = /\\+$/.exec(line)
    if (trailing && trailing[0].length % 2 === 1) {
      acc = line.slice(0, -1)
      continue
    }
    acc = ''
    out.push(line)
  }
  if (acc) out.push(acc)
  return out
}

/** Комментарий вне кавычек до конца строки — это не исполняемая часть. */
function stripComment(line: string): string {
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === quote && line[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i)
  }
  return line
}

/**
 * Сегмент строки — одна команда цепочки, разделённой управляющими операторами.
 */
interface Segment {
  /** Текст сегмента как он стоит в строке. */
  text: string
  /** Границы в исходной строке — по ним собирается непрерывный участок с операторами. */
  start: number
  end: number
  /** Вне кавычек вывод перенаправлен в блочное устройство (`> /dev/sda`). */
  writesDevice: boolean
}

/**
 * Цель перенаправления, ради которой «печать» перестаёт быть печатью.
 *
 * Список устройств тот же, что у правила `overwritesDisk`, и намеренно БЕЗ `sr`:
 * запись в оптический привод (`dd of=/dev/sr0`) — это прожиг образа, обычная
 * работа, а не гарантированная потеря диска.
 */
const DEVICE_TARGET = /^\|?\s*["'`]?\/dev\/(sd|nvme|hd|vd|disk)/i

/**
 * Разбор строки на сегменты по управляющим операторам шелла (`;`, `&&`, `||`, `|`, `&`).
 *
 * ЭТО И ЕСТЬ КОРЕНЬ ПОЧИНКИ. Раньше «только печатает» решалось по НАЧАЛУ строки, и
 * строка целиком выпадала из проверки: `echo starting && rm -rf /` не ловилось ни
 * запретом, ни пометкой — префикса `echo` хватало, чтобы снять оба рубежа сразу.
 * Латать регулярку бессмысленно: цепочку можно продолжить любым из пяти операторов и
 * любой длины. Поэтому строка разбирается на команды, и решение «печатает или
 * исполняет» принимается по КАЖДОЙ из них.
 *
 * Кавычки учитываются: в `echo "curl … | sh"` конвейера нет, там текст, и такая
 * строка обязана остаться безопасной.
 *
 * НЕЗАКРЫТАЯ КАВЫЧКА разбирается вторым заходом, без неё. Один апостроф в тексте
 * (`echo don't && rm -rf /`) открывал кавычку до конца строки, вся строка
 * становилась одним сегментом, и «печать» опять снимала оба рубежа — ровно та дыра,
 * ради которой всё затевалось. Считать такую строку целиком исполняемой было бы
 * проще, но тогда честное `echo don't run rm -rf / on prod` стало бы отказом;
 * второй заход разводит эти два случая правильно.
 */
function segments(line: string, ignoreQuote?: string): Segment[] {
  const out: Segment[] = []
  let quote: string | null = null
  let start = 0
  let writesDevice = false
  const push = (end: number, next: number) => {
    out.push({ text: line.slice(start, end), start, end, writesDevice })
    start = next
    writesDevice = false
  }
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === quote && line[i - 1] !== '\\') quote = null
      continue
    }
    if ((ch === '"' || ch === "'" || ch === '`') && ch !== ignoreQuote) quote = ch
    else if (ch === '\\') i++
    else if (ch === '>') {
      // Опасна не сама перезапись, а её ЦЕЛЬ: `> notes.md` — обычная запись файла.
      if (DEVICE_TARGET.test(line.slice(i + 1).replace(/^>/, ''))) writesDevice = true
    } else if (line.startsWith('&&', i) || line.startsWith('||', i)) {
      push(i, i + 2)
      i++
    } else if (ch === ';' || ch === '|' || ch === '&') push(i, i + 1)
  }
  push(line.length, line.length)
  // Кавычка осталась открытой — разбираем заново, считая её обычным символом.
  if (quote && !ignoreQuote) return segments(line, quote)
  return out
}

/**
 * Сегмент лишь ПЕЧАТАЕТ текст, а не исполняет его. Инструкция вправе показать
 * опасную команду как пример («вот так делать нельзя»), и блокировать за это —
 * ровно тот широкий фильтр, из-за которого авторы перестают доверять отказу.
 * Исполнители (`eval`, `bash -c`, `sh -c`) сюда НЕ попадают: у них содержимое
 * кавычек и есть исполняемая часть.
 *
 * Якорь по концу слова обязателен: без него `echoing rm -rf /` и `echoserver && rm
 * -rf /` читались как «печать» — достаточно было назвать свою программу с этой
 * приставки.
 */
const PRINTS_ONLY = /^\s*(?:sudo\s+)?(?:(?:echo|printf)\b|cat\s*<<|#)/i

/**
 * Запись в блочное устройство снимает признак «только печатает»: `echo x > /dev/sda`
 * ничего не печатает, а УНИЧТОЖАЕТ диск — и гасило правило `overwritesDisk`,
 * написанное буквально под эту форму.
 *
 * Смотреть надо именно на цель, а не на факт перенаправления: `echo "rm -rf /" >
 * notes.md` и `echo "alias cleanup='rm -rf ~/tmp'" >> ~/.zshrc` — записка и строка
 * в конфиге, обычная работа. Пока признак снимало ЛЮБОЕ перенаправление, первая из
 * них запрещалась к публикации, вторая помечалась разрушительной, а `echo "rm -rf /"
 * | sudo tee /etc/motd` — то же действие через конвейер — проходила чисто.
 */
const printsOnly = (s: Segment): boolean => !s.writesDevice && PRINTS_ONLY.test(s.text)

/**
 * Куски строки, которые реально исполняются, — по ним и проверяются правила.
 *
 * Их два сорта, и нужны оба:
 *  - непрерывный УЧАСТОК подряд идущих исполняемых сегментов вместе с их операторами
 *    (`curl … | bash`, форк-бомба, `dd … | tee`) — правила, растянутые через конвейер,
 *    иначе развалились бы на части и перестали совпадать;
 *  - каждый исполняемый СЕГМЕНТ отдельно — правила, якоренные на конец команды
 *    (`shutdown -h now$`), иначе их снимал бы любой хвост цепочки.
 *
 * Сегменты «только печатает» выбрасываются вместе со своими кавычками, поэтому
 * `echo "rm -rf /" && npm ci` остаётся безопасным: на проверку уйдёт `npm ci`.
 */
function executableParts(line: string): string[] {
  const parts: string[] = []
  // Учёт уже добавленного — множеством, а не поиском по массиву: длина команды в
  // схеме ничем не ограничена (`text` без валидации), а `includes` по каждому
  // сегменту давал квадрат. Замерено на 8000 сегментов: 218 мс против 3 мс у
  // прежней версии, и это пересчитывается на КАЖДОЙ записи, отрисовке страницы
  // списка и сборке скрипта.
  const seen = new Set<string>()
  const add = (t: string) => {
    if (t && !seen.has(t)) {
      seen.add(t)
      parts.push(t)
    }
  }
  const kept: Segment[] = []
  let runStart = -1
  let runEnd = -1
  const flushRun = () => {
    if (runStart >= 0) add(line.slice(runStart, runEnd).trim())
    runStart = -1
  }
  for (const s of segments(line)) {
    if (!s.text.trim()) continue
    if (printsOnly(s)) {
      flushRun()
      continue
    }
    if (runStart < 0) runStart = s.start
    runEnd = s.end
    kept.push(s)
  }
  flushRun()
  for (const s of kept) add(s.text.trim())
  return parts
}

/**
 * Первое совпадение набора или null. Проверяется КАЖДАЯ строка команды:
 * многострочное поле — это произвольный скрипт, и опасная строка может стоять не
 * первой. Разбор строк (склейка продолжений, комментарии, цепочка команд, «только
 * печатает») один на оба набора: разъедься они, запрет и пометка ловили бы разное
 * в одном тексте.
 */
function firstMatch(command: string, rules: Rule[]): DestructiveMatch | null {
  const text = (command ?? '').trim()
  if (!text) return null
  for (const joined of joinContinuations(text)) {
    for (const part of executableParts(stripComment(joined))) {
      for (const rule of rules) {
        const hit = rule.scan ? rule.scan(part) : rule.re?.exec(part)?.[0]
        if (hit) return { reason: rule.reason, fragment: hit.trim().slice(0, 120) }
      }
    }
  }
  return null
}

/** Запрещённая к публикации команда или null (набор RULES). */
export function findDestructive(command: string): DestructiveMatch | null {
  return firstMatch(command, RULES)
}

/**
 * Пометка «разрушительно, но законно» или null (набор RISKY). Не запрет:
 * вызывающий решает, что с ней делать — проставить пометку блоку на записи или
 * закомментировать пункт в собранном скрипте.
 *
 * ЗАПРЕЩЁННОЕ ПОМЕЧАЕТСЯ ТОЖЕ. Казалось бы, лишнее: то, что не пройдёт запрет, в
 * базу и не попадёт. Но пометка отвечает не на вопрос «пустить ли в базу», а на
 * вопрос «исполнять ли молча», и на него отвечают ПОЗЖЕ и по другим данным:
 *  - списки старше самого детектора лежат в базе как есть и отдаются скриптом
 *    (об этом же говорит докстрока `stepDanger`);
 *  - `assertNoDestructiveSteps` зовут не все пути записи, а `stepDanger` — единственное,
 *    что стоит между командой и собранным скриптом.
 * Пока эти наборы были независимы, `mkfs.ext4 /dev/sda1`, `dd of=/dev/sda`, `curl … |
 * bash`, форк-бомба, `shutdown -h now` и `chmod -R 777 /etc` приезжали в скрипт
 * ИСПОЛНЯЕМЫМИ и без единой пометки — строже всех проверенное оказывалось наименее
 * помеченным. Отсюда инвариант: что запрещено, то как минимум помечено.
 *
 * Не копия правил, а обращение к тем же: копия разошлась бы с оригиналом на первой же
 * правке. Коды причин у RULES свои (`formatsDisk`, `forkBomb`, …), и словарь для автора
 * их уже знает — `DESTRUCTIVE_REASONS` с самого начала объединяет оба набора.
 */
export function findRisky(command: string): DestructiveMatch | null {
  return firstMatch(command, RISKY) ?? findDestructive(command)
}

/** Разрушительна ли команда — для авто-простановки пометки на записи. */
export const isRiskyCommand = (command: string | null | undefined): boolean => findRisky(command ?? '') !== null

/**
 * Разрушителен ли ПУНКТ: пометка автора или шаблон его команды. Ключ причины
 * или null.
 *
 * Одна функция на скрипт и на страницу списка намеренно: разойдись они, человек
 * видел бы на сайте пункт без пометки, а в скрипте — закомментированную команду
 * (или наоборот). Детектор работает и без пометки — списки, написанные до её
 * появления, тоже отдаются скриптом.
 */
export function stepDanger(step: { danger?: boolean | null; command?: string | null }): string | null {
  if (step.danger) return 'danger'
  return findRisky(step.command ?? '')?.reason ?? null
}

/**
 * Отказ записи. Живёт в домене, а не в адаптере: его ловят и адаптер, и серверные
 * действия, и MCP — импорт из инфраструктуры в фичу нарушил бы границы слоёв.
 * `reason` — ключ словаря, чтобы причина доходила до автора на его языке.
 */
/**
 * Все коды причин, какие страж умеет назвать, — выведены ИЗ САМИХ ПРАВИЛ.
 *
 * Нужны интерфейсу: форма создания показывает причину словами и потому обязана иметь
 * словарь на каждый код. Перечислять коды там руками нельзя — добавь правило, и в форме
 * появится непереведённый код, о чём никто не узнает до первого отказа.
 */
export const DESTRUCTIVE_REASONS: readonly string[] = [...new Set([...RULES, ...RISKY].map((r) => r.reason))]

export class DestructiveCommandError extends Error {
  constructor(
    readonly stepIndex: number,
    readonly reason: string,
    readonly fragment: string,
    /** Файл из `scripts/`, если опасное нашлось в нём, а не в шаге. */
    readonly path?: string,
  ) {
    super(`destructive_command:${reason}`)
    this.name = 'DestructiveCommandError'
  }
}

/** Страж на записи: первый разрушительный шаг останавливает публикацию целиком. */
export function assertNoDestructiveSteps(steps: { command?: string | null }[]): void {
  const found = findDestructiveSteps(steps)
  if (!found.length) return
  const first = found[0]
  throw new DestructiveCommandError(first.index + 1, first.match.reason, first.match.fragment)
}

/**
 * Страж записи С ФАЙЛАМИ АВТОРА: шаги и тексты `scripts/*` — на одну проверку.
 *
 * Ровно то же, что делает ядро на push (`cli.rs`, check-content): скрипты подаются
 * «командами» после блоков. Иначе `rm -rf /`, который форма не пустит в шаг, въезжал бы
 * в `scripts/run.sh` через агента — и уходил в каждый поставленный скилл. `references/`
 * и `assets/` не исполняются и не проверяются — как на push.
 */
export function assertNoDestructiveContent(
  steps: { command?: string | null }[],
  authored: { path: string; content: Uint8Array }[] | undefined,
): void {
  assertNoDestructiveSteps(steps)
  for (const f of authored ?? []) {
    if (!f.path.startsWith('scripts/')) continue
    const match = findDestructiveInScript(f.path, new TextDecoder().decode(f.content))
    if (match) throw new DestructiveCommandError(0, match.reason, match.fragment, f.path)
  }
}

/**
 * СКРИПТ НЕ НА ШЕЛЛЕ: что он отдаёт на исполнение.
 *
 * Детектор выше читает шелл. Скрипт на Python или JS шеллом не является — его текст целиком
 * судить нельзя (`print("не запускайте rm -rf /")` дал бы ложный отказ), а пропускать —
 * значит пропускать `os.system("rm -rf /")`. Поэтому из такого скрипта вынимаются ТОЛЬКО
 * команды, переданные на исполнение (`os.system`, `subprocess.*`, `execSync`, `system`…),
 * строкой или списком аргументов, и судятся тем же набором правил, что шаг. Отдельно —
 * удаление корня средствами самого языка (`shutil.rmtree("/")`, `fs.rmSync("/")`), у которого
 * шелловой строки нет вовсе.
 */
const EXEC_CALL =
  /\b(?:os\.system|os\.popen|subprocess\.(?:run|call|check_call|check_output|Popen)|(?:child_process\.)?(?:execSync|execFileSync|exec|spawnSync|spawn)|Kernel\.system|system|exec)\s*\(\s*/g
/** Строковый литерал: префиксы Python (f/r/b), тройные кавычки, одинарные, двойные, обратные. */
const LITERAL = /^(?:[fFrRbBuU]{0,2})("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)/
const ROOT_REMOVE = /(?:\bshutil\.rmtree|\.rmSync|\.rmdirSync|\bfs\.rm|\bFileUtils\.rm_rf|\brmtree)\s*\(\s*(?:[fFrRbB]{0,2})(["'`])(?:\/|~|\$HOME)\/?\*?\1/

const unquote = (lit: string) => lit.replace(/^("""|'''|["'`])/, '').replace(/("""|'''|["'`])$/, '')

/** Команды, которые скрипт отдаёт на исполнение: строкой или списком аргументов через пробел. */
export function execCommandsIn(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(EXEC_CALL)) {
    const rest = text.slice((m.index ?? 0) + m[0].length)
    const lit = LITERAL.exec(rest)
    if (lit) {
      out.push(unquote(lit[1]))
      continue
    }
    if (rest.startsWith('[')) {
      const end = rest.indexOf(']')
      const parts = [...rest.slice(1, end < 0 ? undefined : end).matchAll(/(["'])((?:\\.|(?!\1)[^\\])*)\1/g)].map((x) => x[2])
      if (parts.length) out.push(parts.join(' '))
    }
  }
  return out
}

/** Шелл ли это: по расширению, иначе по шебангу; без того и другого — шелл (как было). */
function isShellScript(path: string, text: string): boolean {
  const name = path.replace(/@[0-9a-f]{8}$/, '')
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase()
  if (ext) return ['sh', 'bash', 'zsh', 'ksh', 'ps1', 'cmd', 'bat'].includes(ext)
  const bang = /^#!\s*(\S+)(?:\s+(\S+))?/.exec(text)
  if (!bang) return true
  const interp = (bang[1].endsWith('/env') ? bang[2] : bang[1])?.split('/').pop() ?? ''
  return /^(ba|z|k|da)?sh$/.test(interp)
}

/**
 * Разрушительное в файле скрипта: шелл судится целиком, как шаг; прочее — по командам,
 * отданным на исполнение, и по удалению корня средствами языка.
 */
export function findDestructiveInScript(path: string, text: string): DestructiveMatch | null {
  if (isShellScript(path, text)) return findDestructive(text)
  for (const cmd of execCommandsIn(text)) {
    const hit = findDestructive(cmd)
    if (hit) return hit
  }
  const root = ROOT_REMOVE.exec(text)
  return root ? { reason: 'wipesFilesystem', fragment: root[0] } : null
}

/** Индексы шагов с разрушительными командами — для отказа на записи. */
export function findDestructiveSteps(items: { command?: string | null }[]): { index: number; match: DestructiveMatch }[] {
  const out: { index: number; match: DestructiveMatch }[] = []
  items.forEach((it, index) => {
    const match = findDestructive(it.command ?? '')
    if (match) out.push({ index, match })
  })
  return out
}
