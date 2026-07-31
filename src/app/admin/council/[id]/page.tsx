import { redirect } from 'next/navigation'

/** Личная страница специалиста переехала в «Компанию» → «Состав» (2026-07-31). */
export default async function CouncilMemberMovedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/admin/company/staff/${id}`)
}
