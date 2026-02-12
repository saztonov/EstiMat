'use client'

import { Loader2, Check, X } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

interface ApproveButtonProps {
  onClick: () => void
  loading?: boolean
  disabled?: boolean
}

export function ApproveButton({ onClick, loading, disabled }: ApproveButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading || disabled}
      className={cn(
        'inline-flex h-9 items-center justify-center gap-2 rounded-md bg-green-600 px-4 text-sm font-medium text-white shadow transition-colors',
        'hover:bg-green-700',
        'disabled:cursor-not-allowed disabled:opacity-50'
      )}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Check className="h-4 w-4" />
      )}
      Утвердить
    </button>
  )
}

export function RejectButton({ onClick, loading, disabled }: ApproveButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading || disabled}
      className={cn(
        'inline-flex h-9 items-center justify-center gap-2 rounded-md bg-red-600 px-4 text-sm font-medium text-white shadow transition-colors',
        'hover:bg-red-700',
        'disabled:cursor-not-allowed disabled:opacity-50'
      )}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <X className="h-4 w-4" />
      )}
      Отклонить
    </button>
  )
}
