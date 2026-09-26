'use client'

import { useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FileCode, FileDown, FileText } from 'lucide-react'
import { t, type Lang, type TKey } from '@/shared/i18n'
import { AUTHORED_DIRS, AUTHORED_NAME_MAX_BYTES, authoredPathProblem, type AuthoredDir, type AuthoredText } from '@/core/domain/authored-path'
import { cardClass } from '@/shared/ui/card-style'
import { CodeEditor } from '@/shared/ui/CodeEditor'
import { Alert } from '@/shared/ui/Alert'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { MenuItem } from '@/shared/ui/MenuItem'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { TEXT } from '@/shared/ui/control'
import { formatBytes } from '@/shared/lib/format-bytes'
import { parseLfsPointer } from '@/core/domain/lfs-pointer'
import { CheckLabel, RemoveBtn } from './block-fields'

/**
 * ФАЙЛЫ СКИЛЛА В РЕДАКТОРЕ — `scripts/`, `references/`, `assets/` правятся тут же, рядом
 * с шагами, и уходят в ту же версию.
 *
 * Форма шлёт набор ЦЕЛИКОМ в поле `authored`, но только если его трогали: пустое поле
 * значит «файлы не трогали» (ядро перенесёт набор родителя), а `[]` — «убрали все».
 * Спутать их значило бы стереть файлы у каждого, кто правил только шаги.
 *
 * `initial === null` — файлы версии не прочитались: править нечего, и поле не шлётся
 * вовсе — публикация оставит файлы как есть, а человек видит, почему правка недоступна.
 */
export function SkillFilesEditor({ initial, dirty: startDirty, lang }: { initial: AuthoredText[] | null; dirty: boolean; lang: Lang }) {
  const [files, setFiles] = useState<AuthoredText[]>(initial ?? [])
  // Черновик уже держит правку файлов — набор шлётся снова, иначе сохранение без касаний
  // файлов ничего бы не сломало, но «изменены» пропадало бы с экрана.
  const [dirty, setDirty] = useState(startDirty)
  const [open, setOpen] = useState<string | null>(null)
  const [dir, setDir] = useState<AuthoredDir>('scripts')
  const [name, setName] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  if (initial === null) {
    return (
      <Section count={null} lang={lang}>
        <Alert variant="warn" className="m-3">
          <span className="block">{t('skillFilesUnreadable', lang)}</span>
        </Alert>
      </Section>
    )
  }

  const change = (next: AuthoredText[]) => {
    setFiles(next)
    setDirty(true)
  }
  const patch = (path: string, p: Partial<AuthoredText>) => change(files.map((f) => (f.path === path ? { ...f, ...p } : f)))

  const pathMessage = (why: string) =>
    t(`skillFilePath.${why}` as TKey, lang)
      .replace('{n}', String(AUTHORED_NAME_MAX_BYTES))
      .replace('{half}', String(AUTHORED_NAME_MAX_BYTES / 2))

  const add = () => {
    const path = `${dir}/${name.trim()}`
    const why = files.some((f) => f.path === path) ? 'dup' : authoredPathProblem(path, false)
    if (why) {
      setProblem(pathMessage(why))
      return
    }
    // Скрипт по умолчанию исполняемый — так его и запускают (`scripts/run.sh`); снять можно.
    change([...files, { path, text: '', executable: dir === 'scripts' }])
    setOpen(path)
    setName('')
    setProblem(null)
  }

  /**
   * Загрузка файла с диска — в выбранную папку, под его именем. Тот же путь уже есть — файл
   * ЗАМЕНЯЕТСЯ: двоичный иначе поменять нечем. Ответ маршрута — то, что ляжет в набор:
   * текст текстом, двоичное — указателем (байты уже в хранилище).
   */
  const upload = async (file: File) => {
    const path = `${dir}/${file.name}`
    const why = authoredPathProblem(path, false)
    if (why) {
      setProblem(pathMessage(why))
      return
    }
    setUploading(true)
    setProblem(null)
    try {
      const body = new FormData()
      body.set('file', file)
      body.set('path', path)
      const res = await fetch('/api/skill-asset', { method: 'POST', body })
      const data = (await res.json().catch(() => ({}))) as { text?: string; kind?: string; error?: string }
      if (!res.ok || typeof data.text !== 'string') {
        setProblem(t('skillFileUploadFailed', lang).replace('{why}', data.error ?? String(res.status)))
        return
      }
      const next = { path, text: data.text, executable: data.kind === 'text' && dir === 'scripts' }
      change([...files.filter((f) => f.path !== path), next])
      setOpen(path)
    } catch {
      setProblem(t('skillFileUploadFailed', lang).replace('{why}', t('tryAgain', lang)))
    } finally {
      setUploading(false)
    }
  }

  return (
    <Section count={files.length} lang={lang}>
      {/* Набор — только если трогали: см. комментарий к компоненту. */}
      {dirty ? <input type="hidden" name="authored" value={JSON.stringify(files)} /> : null}
      <p className={`px-3 pt-2 ${TEXT.caption} text-muted`}>{t('skillFilesHint', lang)}</p>
      {files.length ? (
        <ul className="mt-2 divide-y divide-border border-y border-border">
          {files.map((f) => {
            const isOpen = open === f.path
            // Двоичный файл лежит указателем: показываем размер, а не текст указателя.
            const pointer = f.path.startsWith('assets/') ? parseLfsPointer(f.text) : null
            return (
              <li key={f.path}>
                <div className="flex min-w-0 items-center gap-1 pr-2">
                  <MenuItem aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : f.path)} className="min-w-0 flex-1 rounded-none">
                    {isOpen ? <ChevronDown size={14} className="shrink-0 text-muted" /> : <ChevronRight size={14} className="shrink-0 text-muted" />}
                    {pointer ? (
                      <FileDown size={14} className="shrink-0 text-muted" />
                    ) : f.executable ? (
                      <FileCode size={14} className="shrink-0 text-muted" />
                    ) : (
                      <FileText size={14} className="shrink-0 text-muted" />
                    )}
                    <span className="min-w-0 flex-1 truncate font-mono text-ink">{f.path}</span>
                    {pointer ? <span className="shrink-0 font-mono text-caption text-muted">{formatBytes(pointer.size)}</span> : null}
                    {f.executable ? <span className="shrink-0 rounded border border-border px-1 text-caption text-muted">755</span> : null}
                  </MenuItem>
                  <RemoveBtn
                    label={`${t('skillFileRemove', lang)}: ${f.path}`}
                    onClick={() => {
                      change(files.filter((x) => x.path !== f.path))
                      if (isOpen) setOpen(null)
                    }}
                  />
                </div>
                {isOpen && pointer ? <p className={`px-3 pb-3 ${TEXT.caption} text-muted`}>{t('skillFileBinaryHint', lang)}</p> : null}
                {isOpen && !pointer && (
                  <div className={`flex flex-col gap-2 px-3 pb-3 ${TEXT.bodySm}`}>
                    <CodeEditor lang={lang} value={f.text} onChange={(text) => patch(f.path, { text })} ariaLabel={f.path} maxHeightClass="max-h-96" />
                    {/* Исполняемыми бывают только скрипты — правило ядра, у прочих тумблера нет. */}
                    {f.path.startsWith('scripts/') ? (
                      <CheckLabel checked={f.executable} onChange={(executable) => patch(f.path, { executable })}>
                        {t('skillFileExecutable', lang)}
                      </CheckLabel>
                    ) : null}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      ) : null}
      {/* Добавление: папка + имя. На телефоне в столбик — имя файла на 320px в ряд с
          выбором папки и кнопкой не помещается. */}
      <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
        <Select value={dir} onValueChange={(v) => setDir(v as AuthoredDir)}>
          <SelectTrigger aria-label={t('skillFileFolder', lang)} className="sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AUTHORED_DIRS.map((d) => (
              <SelectItem key={d} value={d}>
                <span className="font-mono">{d}/</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setProblem(null)
            }}
            // Enter в поле имени добавляет файл, а не отправляет всю форму редактора.
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (name.trim()) add()
              }
            }}
            aria-label={t('skillFileName', lang)}
            aria-invalid={problem ? true : undefined}
            placeholder={t('skillFileName', lang)}
            className="font-mono"
          />
          {problem ? <span className="text-caption text-danger">{problem}</span> : null}
        </div>
        <Button onClick={add} disabled={!name.trim()}>
          {t('skillFileAdd', lang)}
        </Button>
        {/* Файл с диска — в выбранную папку, под своим именем; двоичный допускается в assets/. */}
        <input
          ref={picker}
          type="file"
          hidden
          aria-hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void upload(file)
          }}
        />
        <Button variant="ghost" onClick={() => picker.current?.click()} disabled={uploading}>
          {t('skillFileUpload', lang)}
        </Button>
      </div>
      {dirty ? <p className={`px-3 pb-3 ${TEXT.caption} text-muted`}>{t('skillFilesChanged', lang)}</p> : null}
    </Section>
  )
}

function Section({ count, lang, children }: { count: number | null; lang: Lang; children: React.ReactNode }) {
  return (
    <section aria-labelledby="skill-files-edit" className={`${cardClass({ pad: 'none' })} mt-6 overflow-hidden`}>
      <h2 id="skill-files-edit" className="flex items-center justify-between gap-2 border-b border-border bg-surface-2 px-3 py-2 text-body-sm font-semibold text-ink">
        <span>{t('skillFilesTitle', lang)}</span>
        {count !== null ? <span className="font-normal text-muted">{t('skillFilesCount', lang).replace('{n}', String(count))}</span> : null}
      </h2>
      {children}
    </section>
  )
}
