'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDown, Search, X, Package, Loader2 } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { useMaterials } from '../api/queries'
import { useDebounce } from '@/shared/lib/use-debounce'

interface MaterialSelectProps {
  value?: string
  onChange: (id: string) => void
  groupId?: string
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function MaterialSelect({
  value,
  onChange,
  groupId,
  placeholder = 'Выберите материал',
  disabled = false,
  className,
}: MaterialSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: materials = [], isLoading } = useMaterials({
    search: debouncedSearch || undefined,
    group_id: groupId,
  })

  const selectedMaterial = useMemo(
    () => materials.find((m) => m.id === value),
    [materials, value]
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
        {selectedMaterial ? (
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate">{selectedMaterial.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              ({selectedMaterial.unit})
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
        <div className="flex items-center gap-1 shrink-0">
          {value && selectedMaterial && (
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
              placeholder="Поиск материала..."
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
            ) : materials.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground">
                Материалы не найдены
              </div>
            ) : (
              materials.map((material) => (
                <button
                  key={material.id}
                  type="button"
                  onClick={() => handleSelect(material.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left text-sm transition-colors',
                    'hover:bg-accent hover:text-accent-foreground',
                    material.id === value && 'bg-accent'
                  )}
                >
                  <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{material.name}</div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Ед.: {material.unit}</span>
                      {material.group && (
                        <>
                          <span className="text-border">|</span>
                          <span className="truncate">
                            {material.group.name}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
