import { redirect } from 'next/navigation'

// Юридические тексты живут в доках (единый источник правды).
export default function PrivacyPage() {
  redirect('https://docs.setfork.com/docs/legal/privacy')
}
