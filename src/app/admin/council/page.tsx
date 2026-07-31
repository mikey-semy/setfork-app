import { redirect } from 'next/navigation'

/** «Зал совета» переехал в «Компанию» → «Состав» (2026-07-31). Старый адрес — в закладках. */
export default async function CouncilMovedPage() {
  redirect('/admin/company/staff')
}
