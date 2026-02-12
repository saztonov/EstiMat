'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDown, Search, X, FolderKanban, Loader2 } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { useProjects } from '../api/queries'
import { useDebounce } from '@/shared/lib/use-debounce'
import { PROJECT_STATUS_LABELS } from './project-status-labels'

interface ProjectSelectProps {
  value?: string
  onChange: (id: string) => void
  orgId?: string
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function ProjectSelect({
  value,
  onChange,
  orgId,
  placeholder = 'Выберите проект',
  disabled = false,
  className,
}: ProjectSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: projects = [], isLoading } = useProjects({
    search: debouncedSearch || undefined,
    org_id: orgId,
  })

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === value),
    [projects, value]
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
        <span className={cn('truncate', !selectedProject && 'text-muted-foreground')}>
          {selectedProject ? selectedProject.name : placeholder}
        </span>
        <div className="flex items-center gap-1">
          {value && selectedProject && (
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
              placeholder="Поиск проекта..."
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
            ) : projects.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground">
                Проекты не найдены
              </div>
            ) : (
              projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => handleSelect(project.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left text-sm transition-colors',
                    'hover:bg-accent hover:text-accent-foreground',
                    project.id === value && 'bg-accent'
                  )}
                >
                  <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{project.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {PROJECT_STATUS_LABELS[project.status] ?? project.status}
                      {project.organization && ` \u00b7 ${project.organization.name}`}
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
