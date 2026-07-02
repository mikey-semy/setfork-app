'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { SearchInput } from '@/shared/ui/SearchInput'

// Поиск на лендинге: печатаешь → Enter/стрелка → /explore?q=…, с кнопкой очистки.
export function HeroSearch({ placeholder, clearLabel }: { placeholder: string; clearLabel: string }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const go = () => {
    const s = q.trim()
    router.push(s ? `/explore?q=${encodeURIComponent(s)}` : '/explore')
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        go()
      }}
      className="flex w-full max-w-[600px] items-center gap-3 rounded-[14px] border border-border bg-surface px-4 py-3.5 shadow-[0_12px_36px_-14px_rgba(0,0,0,.22)]"
    >
      <SearchInput
        value={q}
        onChange={setQ}
        placeholder={placeholder}
        className="flex-1"
        inputClassName="border-0 bg-transparent py-1 text-[15px] focus:border-0"
        clearLabel={clearLabel}
        autoFocus
      />
      <button type="submit" className="grid h-[34px] w-[34px] flex-shrink-0 place-items-center rounded-md bg-primary text-primary-fg" aria-label="Search">
        <ArrowRight size={16} />
      </button>
    </form>
  )
}
