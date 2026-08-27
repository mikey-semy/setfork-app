'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { IconButton } from '@/shared/ui/IconButton'
import { SearchField } from '@/shared/ui/SearchField'

// Поиск на лендинге: печатаешь → Enter/стрелка → /explore?q=…, с кнопкой очистки.
export function HeroSearch({ placeholder, clearLabel }: { placeholder: string; clearLabel: string }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const go = () => {
    const s = q.trim()
    router.push(s ? `/search?q=${encodeURIComponent(s)}` : '/search')
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        go()
      }}
      className="flex w-full max-w-hero items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3.5 shadow-hero"
    >
      <SearchField
        variant="bare"
        size="xl"
        value={q}
        onValueChange={setQ}
        placeholder={placeholder}
        className="flex-1"
        clearLabel={clearLabel}
        autoFocus
      />
      {/* Ступень ряда, а не своя: рядом стоит поле-герой `xl`, и 34px против 44px
          читались ступенькой ровно там, где страница смотрит на человека. */}
      <IconButton type="submit" size="xl" variant="primary" label="Search">
        <ArrowRight size={16} />
      </IconButton>
    </form>
  )
}
