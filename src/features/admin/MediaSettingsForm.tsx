'use client'

import { Switch } from '@/shared/ui/switch'
import { setMediaSettings } from './actions'

const field = 'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[14px] text-ink outline-none focus:border-border-strong'
const lbl = 'mb-1.5 block text-[12.5px] font-semibold text-ink-2'

export interface MediaFormValues {
  s3Endpoint: string
  s3Region: string
  s3Bucket: string
  s3Prefix: string
  s3AccessKey: string
  imgproxyUrl: string
  cdnUrl: string
  useImgproxy: boolean
  // маски секретов (реальные значения на клиент не уходят)
  s3SecretMask: string
  imgproxyKeyMask: string
  imgproxySaltMask: string
}

export function MediaSettingsForm({ ru, v }: { ru: boolean; v: MediaFormValues }) {
  const secretPh = ru ? '•••• (задан) — оставьте пустым, чтобы не менять' : '•••• (set) — leave blank to keep'
  return (
    <form action={setMediaSettings} className="flex flex-col gap-5">
      <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2.5 text-[12.5px] text-warn">
        {ru
          ? 'Значения S3/ключей подписи должны совпадать с окружением контейнера imgproxy. Пустое поле = берётся из .env. После смены кредов или ключей перезапустите контейнер imgproxy.'
          : 'S3 / signing-key values must match the imgproxy container environment. Empty field = taken from .env. After changing credentials or keys, restart the imgproxy container.'}
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[14px] font-medium text-ink">{ru ? 'Отдавать через imgproxy' : 'Serve via imgproxy'}</div>
          <p className="text-[12px] text-muted">
            {ru ? 'Выкл — картинки берутся напрямую (без трансформаций).' : 'Off — images are used directly (no transforms).'}
          </p>
        </div>
        <Switch name="useImgproxy" defaultChecked={v.useImgproxy} />
      </div>

      <div className="text-[12.5px] font-semibold text-ink">{ru ? 'S3-хранилище' : 'S3 storage'}</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={lbl}>Endpoint</label>
          <input name="s3Endpoint" defaultValue={v.s3Endpoint} placeholder="https://s3.ru-3.storage.selcloud.ru" className={`${field} font-mono`} />
        </div>
        <div>
          <label className={lbl}>Region</label>
          <input name="s3Region" defaultValue={v.s3Region} placeholder="ru-3" className={`${field} font-mono`} />
        </div>
        <div>
          <label className={lbl}>Bucket</label>
          <input name="s3Bucket" defaultValue={v.s3Bucket} placeholder="sethub" className={`${field} font-mono`} />
        </div>
        <div>
          <label className={lbl}>{ru ? 'Префикс пути' : 'Path prefix'}</label>
          <input name="s3Prefix" defaultValue={v.s3Prefix} placeholder={ru ? 'напр. prod' : 'e.g. prod'} className={`${field} font-mono`} />
        </div>
        <div>
          <label className={lbl}>Access key</label>
          <input name="s3AccessKey" defaultValue={v.s3AccessKey} autoComplete="off" className={`${field} font-mono`} />
        </div>
        <div>
          <label className={lbl}>Secret key</label>
          <input name="s3SecretKey" type="password" placeholder={v.s3SecretMask || secretPh} autoComplete="off" className={`${field} font-mono`} />
        </div>
      </div>

      <div className="text-[12.5px] font-semibold text-ink">imgproxy</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={lbl}>{ru ? 'Публичный URL (браузер)' : 'Public URL (browser)'}</label>
          <input name="imgproxyUrl" defaultValue={v.imgproxyUrl} placeholder="https://img.example.com" className={`${field} font-mono`} />
        </div>
        <div>
          <label className={lbl}>Key (hex)</label>
          <input name="imgproxyKey" type="password" placeholder={v.imgproxyKeyMask || secretPh} autoComplete="off" className={`${field} font-mono`} />
        </div>
        <div>
          <label className={lbl}>Salt (hex)</label>
          <input name="imgproxySalt" type="password" placeholder={v.imgproxySaltMask || secretPh} autoComplete="off" className={`${field} font-mono`} />
        </div>
      </div>

      <div>
        <label className={lbl}>{ru ? 'CDN URL (перед imgproxy, опц.)' : 'CDN URL (in front of imgproxy, opt.)'}</label>
        <input name="cdnUrl" defaultValue={v.cdnUrl} placeholder="https://cdn.example.com" className={`${field} font-mono`} />
      </div>

      <div className="flex justify-end border-t border-border pt-4">
        <button className="rounded-md bg-primary px-5 py-2.5 text-[14px] font-semibold text-primary-fg">
          {ru ? 'Сохранить' : 'Save'}
        </button>
      </div>
    </form>
  )
}
