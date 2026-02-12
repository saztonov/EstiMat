'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDown, Search, X, Loader2 } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { useUsers } from '../api/queries'
import { useDebounce } from '@/shared/lib/use-debounce'
import { UserAvatar } from './user-avatar'
import { RoleBadge } from './role-badge'

interface UserSelectProps {
  value?: string
  onChange: (id: string) => void
  orgId?: string
  role?: string
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function UserSelect({
  value,
  onChange,
  orgId,
  role,
  placeholder = 'Выберите пользователя',
  disabled = false,
  className,
}: UserSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: users = [], isLoading } = useUsers({
    search: debouncedSearch || undefined,
    org_id: orgId,
    role,
  })

  const selectedUser = useMemo(
    () => users.find((u) => u.id === value),
    [users, value]
  )

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
        {selectedUser ? (
          <div className="flex items-center gap-2 min-w-0">
            <UserAvatar
              fullName={selectedUser.full_name}
              size="sm"
            />
            <span className="truncate text-sm">{selectedUser.full_name}</span>
          </div>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
        <div className="flex items-center gap-1 shrink-0">
          {value && selectedUser && (
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

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-md">
          <div className="flex items-center border-b border-border px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по имени или email..."
              className="flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="max-h-60 overflow-y-auto p-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">
                  Загрузка...
                </span>
              </div>
            ) : users.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground">
                Пользователи не найдены
              </div>
            ) : (
              users.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => handleSelect(user.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left text-sm transition-colors',
                    'hover:bg-accent hover:text-accent-foreground',
                    user.id === value && 'bg-accent'
                  )}
                >
                  <UserAvatar fullName={user.full_name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {user.full_name}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {user.email}
                    </div>
                  </div>
                  <RoleBadge role={user.role} />
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
