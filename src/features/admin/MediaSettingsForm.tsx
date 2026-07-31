'use client'

import { Switch } from '@/shared/ui/switch'
import { Input } from '@/shared/ui/input'
import { Field } from '@/shared/ui/Field'
import { Alert } from '@/shared/ui/Alert'
import { setMediaSettings } from './actions'
import { FormSaveBar } from '@/shared/ui/FormSaveBar'

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
      <Alert variant="warn">
        {ru
          ? 'Значения S3/ключей подписи должны совпадать с окружением контейнера imgproxy. Пустое поле = берётся из .env. После смены кредов или ключей перезапустите контейнер imgproxy.'
          : 'S3 / signing-key values must match the imgproxy container environment. Empty field = taken from .env. After changing credentials or keys, restart the imgproxy container.'}
      </Alert>

      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[14px] font-medium text-ink">{ru ? 'Отдавать через imgproxy' : 'Serve via imgproxy'}</div>
          <p className="text-[12.5px] text-muted">
            {ru ? 'Выкл — картинки берутся напрямую (без трансформаций).' : 'Off — images are used directly (no transforms).'}
          </p>
        </div>
        <Switch name="useImgproxy" defaultChecked={v.useImgproxy} />
      </div>

      <div className="text-[12.5px] font-semibold text-ink">{ru ? 'S3-хранилище' : 'S3 storage'}</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Endpoint">
          <Input name="s3Endpoint" defaultValue={v.s3Endpoint} placeholder="https://s3.ru-3.storage.selcloud.ru" className="font-mono" />
        </Field>
        <Field label="Region">
          <Input name="s3Region" defaultValue={v.s3Region} placeholder="ru-3" className="font-mono" />
        </Field>
        <Field label="Bucket">
          <Input name="s3Bucket" defaultValue={v.s3Bucket} placeholder="setfork" className="font-mono" />
        </Field>
        <Field label={ru ? 'Префикс пути' : 'Path prefix'}>
          <Input name="s3Prefix" defaultValue={v.s3Prefix} placeholder="prod" className="font-mono" />
        </Field>
        <Field label="Access key">
          <Input name="s3AccessKey" defaultValue={v.s3AccessKey} autoComplete="off" className="font-mono" />
        </Field>
        <Field label="Secret key">
          <Input name="s3SecretKey" type="password" placeholder={v.s3SecretMask || secretPh} autoComplete="off" className="font-mono" />
        </Field>
      </div>

      <div className="text-[12.5px] font-semibold text-ink">imgproxy</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={ru ? 'Публичный URL (браузер)' : 'Public URL (browser)'} className="sm:col-span-2">
          <Input name="imgproxyUrl" defaultValue={v.imgproxyUrl} placeholder="https://img.example.com" className="font-mono" />
        </Field>
        <Field label="Key (hex)">
          <Input name="imgproxyKey" type="password" placeholder={v.imgproxyKeyMask || secretPh} autoComplete="off" className="font-mono" />
        </Field>
        <Field label="Salt (hex)">
          <Input name="imgproxySalt" type="password" placeholder={v.imgproxySaltMask || secretPh} autoComplete="off" className="font-mono" />
        </Field>
      </div>

      <Field label={ru ? 'CDN URL (перед imgproxy, опц.)' : 'CDN URL (in front of imgproxy, opt.)'}>
        <Input name="cdnUrl" defaultValue={v.cdnUrl} placeholder="https://cdn.example.com" className="font-mono" />
      </Field>

      <FormSaveBar ru={ru} />
    </form>
  )
}
