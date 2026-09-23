import { describe, expect, it } from 'vitest'
import { s3Target } from '@/shared/media/s3'
import type { MediaSettings } from '@/shared/settings/media'

/** Одна фабрика клиента: цель выбирает бакет и стиль адресации. */
const base = { s3Bucket: 'setfork.data', s3UploadsBucket: '', s3UploadsVhost: false } as MediaSettings

describe('s3Target', () => {
  it('основной бакет — всегда path-style, настройки загрузок его не трогают', () => {
    expect(s3Target({ ...base, s3UploadsBucket: 'up', s3UploadsVhost: true }, 'main')).toEqual({ bucket: 'setfork.data', forcePathStyle: true })
  })

  it('бакет загрузок пуст — основной, path-style (dev-MinIO)', () => {
    expect(s3Target(base, 'uploads')).toEqual({ bucket: 'setfork.data', forcePathStyle: true })
  })

  it('свой бакет загрузок + vHosted — виртуальный хост', () => {
    expect(s3Target({ ...base, s3UploadsBucket: 'setfork-uploads', s3UploadsVhost: true }, 'uploads')).toEqual({
      bucket: 'setfork-uploads',
      forcePathStyle: false,
    })
  })
})
