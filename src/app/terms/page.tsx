import { redirect } from 'next/navigation'

// Юридические тексты живут в доках (единый источник правды).
export default function TermsPage() {
  redirect('https://docs.setfork.com/docs/legal/terms')
}
