'use client'

import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search,
  X,
  FolderKanban,
  FileText,
  ShoppingCart,
  Package,
  Loader2,
  Command,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { useDebounce } from '@/shared/hooks'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchResult {
  id: string
  title: string
  subtitle?: string
  category: SearchCategory
  href: string
}

type SearchCategory = 'projects' | 'tenders' | 'orders' | 'deliveries'

const CATEGORY_CONFIG: Record<
  SearchCategory,
  { label: string; icon: typeof FolderKanban }
> = {
  projects: { label: 'Проекты', icon: FolderKanban },
  tenders: { label: 'Тендеры', icon: FileText },
  orders: { label: 'Заказы', icon: ShoppingCart },
  deliveries: { label: 'Поставки', icon: Package },
}

// ---------------------------------------------------------------------------
// Mock search function (will call real API when ready)
// ---------------------------------------------------------------------------

async function searchAll(query: string): Promise<SearchResult[]> {
  if (!query || query.length < 2) return []

  const res = await fetch(
    `/api/v1/search?q=${encodeURIComponent(query)}`
  ).catch(() => null)

  if (res && res.ok) {
    const data = await res.json()
    return (data.data ?? data.results ?? []) as SearchResult[]
  }

  // Fallback: return empty results if search endpoint doesn't exist yet
  return []
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export function GlobalSearchWidget() {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const debouncedQuery = useDebounce(query, 300)

  // ---- Keyboard shortcut (Ctrl/Cmd + K) ------------------------------------
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsOpen((prev) => !prev)
      }

      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  // ---- Focus input when dialog opens ----------------------------------------
  useEffect(() => {
    if (isOpen) {
      // Small timeout so the DOM is ready
      const timer = setTimeout(() => inputRef.current?.focus(), 50)
      return () => clearTimeout(timer)
    } else {
      setQuery('')
      setResults([])
      setActiveIndex(0)
    }
  }, [isOpen])

  // ---- Debounced search ------------------------------------------------------
  useEffect(() => {
    if (!debouncedQuery || debouncedQuery.length < 2) {
      setResults([])
      setIsSearching(false)
      return
    }

    let cancelled = false
    setIsSearching(true)

    searchAll(debouncedQuery).then((data) => {
      if (!cancelled) {
        setResults(data)
        setIsSearching(false)
        setActiveIndex(0)
      }
    })

    return () => {
      cancelled = true
    }
  }, [debouncedQuery])

  // ---- Group results by category ---------------------------------------------
  const grouped = useMemo(() => {
    const groups: Partial<Record<SearchCategory, SearchResult[]>> = {}
    for (const result of results) {
      const cat = result.category
      if (!groups[cat]) groups[cat] = []
      groups[cat]!.push(result)
    }
    return groups
  }, [results])

  const flatResults = useMemo(
    () =>
      (Object.keys(grouped) as SearchCategory[]).flatMap(
        (cat) => grouped[cat] ?? []
      ),
    [grouped]
  )

  // ---- Keyboard navigation ---------------------------------------------------
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((prev) =>
          prev < flatResults.length - 1 ? prev + 1 : 0
        )
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((prev) =>
          prev > 0 ? prev - 1 : flatResults.length - 1
        )
      } else if (e.key === 'Enter' && flatResults[activeIndex]) {
        e.preventDefault()
        router.push(flatResults[activeIndex].href)
        setIsOpen(false)
      }
    },
    [flatResults, activeIndex, router]
  )

  const handleSelect = useCallback(
    (result: SearchResult) => {
      router.push(result.href)
      setIsOpen(false)
    },
    [router]
  )

  // ---- Render ----------------------------------------------------------------
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => setIsOpen(false)}
      />

      {/* Dialog */}
      <div
        className={cn(
          'relative z-10 w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover shadow-2xl',
          'animate-in fade-in-0 zoom-in-95 duration-200'
        )}
        role="dialog"
        aria-label="Глобальный поиск"
      >
        {/* Search input */}
        <div className="flex items-center border-b border-border px-4">
          <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Поиск по проектам, тендерам, заказам..."
            className="flex-1 bg-transparent px-3 py-3.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button
              onClick={() => {
                setQuery('')
                inputRef.current?.focus()
              }}
              className="p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <kbd className="ml-2 hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="max-h-80 overflow-y-auto overscroll-contain p-2"
        >
          {/* Loading */}
          {isSearching && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">
                Поиск...
              </span>
            </div>
          )}

          {/* No query */}
          {!isSearching && !query && (
            <div className="space-y-3 py-6 text-center">
              <Command className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  Быстрый поиск
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Начните вводить для поиска по всем разделам
                </p>
              </div>
              <div className="flex justify-center gap-2 pt-2">
                {(Object.keys(CATEGORY_CONFIG) as SearchCategory[]).map(
                  (cat) => {
                    const config = CATEGORY_CONFIG[cat]
                    const Icon = config.icon
                    return (
                      <span
                        key={cat}
                        className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground"
                      >
                        <Icon className="h-3 w-3" />
                        {config.label}
                      </span>
                    )
                  }
                )}
              </div>
            </div>
          )}

          {/* Empty results */}
          {!isSearching && query.length >= 2 && results.length === 0 && (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                Ничего не найдено по запросу &laquo;{query}&raquo;
              </p>
            </div>
          )}

          {/* Grouped results */}
          {!isSearching &&
            (Object.keys(grouped) as SearchCategory[]).map((category) => {
              const config = CATEGORY_CONFIG[category]
              const items = grouped[category] ?? []
              if (items.length === 0) return null

              return (
                <Fragment key={category}>
                  <div className="px-2 pb-1 pt-3 first:pt-1">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {config.label}
                    </p>
                  </div>
                  {items.map((result) => {
                    const Icon = config.icon
                    const index = flatResults.indexOf(result)
                    const isActive = index === activeIndex

                    return (
                      <button
                        key={result.id}
                        onClick={() => handleSelect(result)}
                        onMouseEnter={() => setActiveIndex(index)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                          isActive
                            ? 'bg-accent text-accent-foreground'
                            : 'text-foreground hover:bg-accent/50'
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{result.title}</p>
                          {result.subtitle && (
                            <p className="truncate text-xs text-muted-foreground">
                              {result.subtitle}
                            </p>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </Fragment>
              )
            })}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
                &uarr;
              </kbd>
              <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
                &darr;
              </kbd>
              навигация
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
                Enter
              </kbd>
              открыть
            </span>
          </div>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
              Esc
            </kbd>
            закрыть
          </span>
        </div>
      </div>
    </div>
  )
}
