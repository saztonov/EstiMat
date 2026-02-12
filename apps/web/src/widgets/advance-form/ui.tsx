'use client'

import { useState, useCallback } from 'react'
import { Loader2, Banknote } from 'lucide-react'
import { ApprovalFlow, StatusBadge } from '@/shared/components'
import { ApproveButton } from '@/features/approve-entity'
import type { Advance, ApproveAdvancePayload } from '@/entities/request'
import { cn } from '@/shared/lib/utils'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '\u2014'
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '\u2014'
  return new Date(dateString).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

const ADVANCE_STATUS_LABELS: Record<string, string> = {
  draft: 'Черновик',
  review: 'Ожидает утверждения',
  approved: 'Утверждён',
  cancelled: 'Отменён',
  paid: 'Оплачен',
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AdvanceFormWidgetProps {
  requestId: string
  advance: Advance | null
  onApprove: (payload: ApproveAdvancePayload) => Promise<Advance>
  isApproving: boolean
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export function AdvanceFormWidget({
  requestId,
  advance,
  onApprove,
  isApproving,
}: AdvanceFormWidgetProps) {
  const [comment, setComment] = useState('')

  const handleApprove = useCallback(async () => {
    if (!advance) return
    await onApprove({ id: advance.id, comment: comment || undefined })
    setComment('')
  }, [onApprove, advance, comment])

  if (!advance) {
    return (
      <div className="rounded-lg border border-border p-6">
        <div className="flex items-center gap-3">
          <Banknote className="h-5 w-5 text-muted-foreground" />
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              Авансовый платёж
            </h3>
            <p className="text-sm text-muted-foreground">
              Авансовый платёж ещё не создан для данной заявки.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const statusLabel = ADVANCE_STATUS_LABELS[advance.status] ?? advance.status
  const canApprove = advance.status === 'review'

  // Build approval steps
  const approvalSteps = [
    {
      label: 'Создание аванса',
      status: 'approved' as const,
      date: formatDate(advance.created_at),
    },
    {
      label: 'Утверждение',
      status:
        advance.status === 'approved' || advance.status === 'paid'
          ? ('approved' as const)
          : advance.status === 'review'
            ? ('current' as const)
            : advance.status === 'cancelled'
              ? ('rejected' as const)
              : ('pending' as const),
      date: advance.status === 'approved' ? formatDate(advance.approved_at) : undefined,
      user: advance.approved_by ?? undefined,
    },
  ]

  if (advance.status === 'paid') {
    approvalSteps.push({
      label: 'Оплачен',
      status: 'approved' as const,
      date: formatDate(advance.paid_at),
    })
  }

  return (
    <div className="rounded-lg border border-border p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Banknote className="h-5 w-5 text-amber-500" />
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              Авансовый платёж
            </h3>
            <div className="mt-1">
              <StatusBadge status={statusLabel} />
            </div>
          </div>
        </div>
        {canApprove && (
          <ApproveButton onClick={handleApprove} loading={isApproving} />
        )}
      </div>

      {/* Advance details */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-muted-foreground">Сумма аванса</p>
          <p className="text-sm font-bold text-foreground">
            {formatCurrency(advance.amount)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Дата создания</p>
          <p className="text-sm font-medium text-foreground">
            {formatDate(advance.created_at)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Статус</p>
          <div className="mt-1">
            <StatusBadge status={statusLabel} />
          </div>
        </div>
      </div>

      {/* Justification */}
      {advance.justification && (
        <div>
          <p className="text-xs text-muted-foreground">Обоснование</p>
          <p className="mt-1 rounded-md bg-muted px-3 py-2 text-sm text-foreground">
            {advance.justification}
          </p>
        </div>
      )}

      {/* Approval flow */}
      <div>
        <h4 className="mb-3 text-sm font-semibold text-foreground">
          Ход согласования
        </h4>
        <ApprovalFlow steps={approvalSteps} />
      </div>

      {/* Comment for approval */}
      {canApprove && (
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Комментарий к утверждению
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder="Необязательный комментарий..."
            className={cn(
              'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
            )}
          />
        </div>
      )}
    </div>
  )
}
