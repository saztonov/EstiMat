'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDown, Search, X, Building2, Loader2 } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { useOrganizations } from '../api/queries'
import { OrgBadge } from './org-badge'
import { useDebounce } from '@/shared/lib/use-debounce'

interface OrgSelectProps {
  value?: string
  onChange: (id: string) => void
  orgType?: string
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function OrgSelect({
  value,
  onChange,
  orgType,
  placeholder = 'Выберите организацию',
  disabled = false,
  className,
}: OrgSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: organizations = [], isLoading } = useOrganizations({
    search: debouncedSearch || undefined,
    type: orgType,
  })

  const selectedOrg = useMemo(
    () => organizations.find((org) => org.id === value),
    [organizations, value]
  )

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Focus input on open
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  function handleSelect(id: string) {
    onChange(id)
    setIsOpen(false)
    setSearch('')
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation()
    onChange('')
    setSearch('')
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          isOpen && 'ring-1 ring-ring'
        )}
      >
        <span className={cn('truncate', !selectedOrg && 'text-muted-foreground')}>
          {selectedOrg ? selectedOrg.name : placeholder}
        </span>
        <div className="flex items-center gap-1">
          {value && selectedOrg && (
            <span
              role="button"
              tabIndex={0}
              onClick={handleClear}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleClear(e as unknown as React.MouseEvent)
              }}
              className="rounded-sm p-0.5 hover:bg-accent"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          )}
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </div>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-md">
          {/* Search */}
          <div className="flex items-center border-b border-border px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск организации..."
              className="flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          {/* Options */}
          <div className="max-h-60 overflow-y-auto p-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">
                  Загрузка...
                </span>
              </div>
            ) : organizations.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground">
                Организации не найдены
              </div>
            ) : (
              organizations.map((org) => (
                <button
                  key={org.id}
                  type="button"
                  onClick={() => handleSelect(org.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left text-sm transition-colors',
                    'hover:bg-accent hover:text-accent-foreground',
                    org.id === value && 'bg-accent'
                  )}
                >
                  <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{org.name}</div>
                    {org.inn && (
                      <div className="text-xs text-muted-foreground">
                        ИНН: {org.inn}
                      </div>
                    )}
                  </div>
                  <OrgBadge type={org.type} />
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
