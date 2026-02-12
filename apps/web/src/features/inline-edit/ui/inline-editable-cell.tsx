'use client'

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Check, X, Pencil } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

interface InlineEditableCellProps {
  value: string | number
  onSave: (value: string | number) => void
  type?: 'text' | 'number'
  /** Placeholder shown when value is empty */
  placeholder?: string
  /** Whether the cell is disabled */
  disabled?: boolean
  /** Additional CSS class for the wrapper */
  className?: string
  /** Format function for display mode */
  formatValue?: (value: string | number) => string
}

export function InlineEditableCell({
  value,
  onSave,
  type = 'text',
  placeholder = 'Нажмите для редактирования',
  disabled = false,
  className,
  formatValue,
}: InlineEditableCellProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(String(value))
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync editValue when value changes externally
  useEffect(() => {
    if (!isEditing) {
      setEditValue(String(value))
    }
  }, [value, isEditing])

  // Focus the input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const startEditing = useCallback(() => {
    if (disabled) return
    setEditValue(String(value))
    setIsEditing(true)
  }, [disabled, value])

  const cancelEditing = useCallback(() => {
    setEditValue(String(value))
    setIsEditing(false)
  }, [value])

  const saveValue = useCallback(() => {
    const trimmed = editValue.trim()

    if (type === 'number') {
      const numVal = parseFloat(trimmed)
      if (!isNaN(numVal) && numVal !== value) {
        onSave(numVal)
      }
    } else {
      if (trimmed !== String(value)) {
        onSave(trimmed)
      }
    }

    setIsEditing(false)
  }, [editValue, type, value, onSave])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        saveValue()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancelEditing()
      }
    },
    [saveValue, cancelEditing]
  )

  const displayValue =
    formatValue
      ? formatValue(value)
      : type === 'number' && typeof value === 'number'
        ? value.toLocaleString('ru-RU')
        : String(value)

  if (isEditing) {
    return (
      <div className={cn('flex items-center gap-1', className)}>
        <input
          ref={inputRef}
          type={type}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={saveValue}
          step={type === 'number' ? 'any' : undefined}
          className={cn(
            'h-7 w-full min-w-0 rounded border border-primary bg-transparent px-2 text-sm shadow-sm transition-colors',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            type === 'number' && 'text-right tabular-nums'
          )}
        />
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault()
            saveValue()
          }}
          className="shrink-0 rounded-sm p-0.5 text-green-600 transition-colors hover:bg-green-100 dark:hover:bg-green-900"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault()
            cancelEditing()
          }}
          className="shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-accent"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={startEditing}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          startEditing()
        }
      }}
      className={cn(
        'group flex min-h-[28px] items-center rounded px-2 py-0.5 transition-colors',
        !disabled && 'cursor-pointer hover:bg-muted/60',
        disabled && 'cursor-default opacity-60',
        className
      )}
    >
      <span
        className={cn(
          'flex-1 text-sm',
          type === 'number' && 'tabular-nums text-right',
          !value && value !== 0 && 'text-muted-foreground'
        )}
      >
        {value || value === 0 ? displayValue : placeholder}
      </span>
      {!disabled && (
        <Pencil className="ml-1 h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </div>
  )
}
