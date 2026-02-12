'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, ChevronDown, Check } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { useDebounce } from '@/shared/hooks'

interface ComboboxOption {
  label: string
  value: string
}

interface InlineComboboxProps {
  value: string
  options: ComboboxOption[]
  onSelect: (value: string) => void
  placeholder?: string
  /** Whether the combobox is disabled */
  disabled?: boolean
  /** Additional CSS class for the wrapper */
  className?: string
  /** Display label for the current value (if different from options) */
  displayLabel?: string
}

export function InlineCombobox({
  value,
  options,
  onSelect,
  placeholder = 'Выберите...',
  disabled = false,
  className,
  displayLabel,
}: InlineComboboxProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const debouncedSearch = useDebounce(search, 200)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selectedOption = useMemo(
    () => options.find((o) => o.value === value),
    [options, value]
  )

  const filteredOptions = useMemo(() => {
    if (!debouncedSearch.trim()) return options

    const lower = debouncedSearch.toLowerCase()
    return options.filter((o) => o.label.toLowerCase().includes(lower))
  }, [options, debouncedSearch])

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
        setSearch('')
        setHighlightedIndex(-1)
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

  // Reset highlighted index when options change
  useEffect(() => {
    setHighlightedIndex(-1)
  }, [debouncedSearch])

  const handleOpen = useCallback(() => {
    if (disabled) return
    setIsOpen(true)
    setSearch('')
    setHighlightedIndex(-1)
  }, [disabled])

  const handleSelect = useCallback(
    (optionValue: string) => {
      onSelect(optionValue)
      setIsOpen(false)
      setSearch('')
      setHighlightedIndex(-1)
    },
    [onSelect]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault()
          handleOpen()
        }
        return
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setHighlightedIndex((prev) =>
            prev < filteredOptions.length - 1 ? prev + 1 : 0
          )
          break
        case 'ArrowUp':
          e.preventDefault()
          setHighlightedIndex((prev) =>
            prev > 0 ? prev - 1 : filteredOptions.length - 1
          )
          break
        case 'Enter':
          e.preventDefault()
          if (
            highlightedIndex >= 0 &&
            highlightedIndex < filteredOptions.length
          ) {
            handleSelect(filteredOptions[highlightedIndex].value)
          }
          break
        case 'Escape':
          e.preventDefault()
          setIsOpen(false)
          setSearch('')
          setHighlightedIndex(-1)
          break
      }
    },
    [isOpen, filteredOptions, highlightedIndex, handleOpen, handleSelect]
  )

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex < 0 || !listRef.current) return

    const items = listRef.current.querySelectorAll('[data-combobox-option]')
    const item = items[highlightedIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex])

  const currentLabel =
    displayLabel || selectedOption?.label || ''

  return (
    <div
      ref={containerRef}
      className={cn('relative', className)}
      onKeyDown={handleKeyDown}
    >
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={handleOpen}
        className={cn(
          'flex h-8 w-full items-center justify-between rounded-md border border-input bg-transparent px-2 text-sm shadow-sm transition-colors',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          isOpen && 'ring-1 ring-ring'
        )}
      >
        <span
          className={cn(
            'truncate',
            !currentLabel && 'text-muted-foreground'
          )}
        >
          {currentLabel || placeholder}
        </span>
        <ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full min-w-[200px] rounded-md border border-border bg-popover shadow-md">
          {/* Search input */}
          <div className="flex items-center border-b border-border px-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск..."
              className="flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          {/* Options list */}
          <div
            ref={listRef}
            className="max-h-48 overflow-y-auto p-1"
            role="listbox"
          >
            {filteredOptions.length === 0 ? (
              <div className="py-3 text-center text-sm text-muted-foreground">
                Ничего не найдено
              </div>
            ) : (
              filteredOptions.map((option, index) => (
                <button
                  key={option.value}
                  type="button"
                  data-combobox-option
                  role="option"
                  aria-selected={option.value === value}
                  onClick={() => handleSelect(option.value)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors',
                    'hover:bg-accent hover:text-accent-foreground',
                    index === highlightedIndex && 'bg-accent text-accent-foreground',
                    option.value === value && 'font-medium'
                  )}
                >
                  <Check
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      option.value === value
                        ? 'text-primary'
                        : 'text-transparent'
                    )}
                  />
                  <span className="truncate">{option.label}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
