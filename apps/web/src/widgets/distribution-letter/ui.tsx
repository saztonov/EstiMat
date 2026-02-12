'use client'

import { useState, useCallback } from 'react'
import { Loader2, FileText } from 'lucide-react'
import { ApprovalFlow, StatusBadge } from '@/shared/components'
import { ApproveButton } from '@/features/approve-entity'
import type { DistributionLetter, PrItemWithRelations, ApproveDistLetterPayload } from '@/entities/request'
import { cn } from '@/shared/lib/utils'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '\u2014'
  return new Date(dateString).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

const DIST_STATUS_LABELS: Record<string, string> = {
  draft: 'Черновик',
  rp_review: 'Ожидает РП',
  rp_approved: 'Утверждено РП',
  obs_review: 'Ожидает ОБС',
  obs_approved: 'Утверждено',
  paid: 'Оплачено',
  cancelled: 'Отменено',
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DistributionLetterWidgetProps {
  requestId: string
  distLetter: DistributionLetter | null
  onApprove: (payload: ApproveDistLetterPayload) => Promise<DistributionLetter>
  isApproving: boolean
  items: PrItemWithRelations[]
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export function DistributionLetterWidget({
  requestId,
  distLetter,
  onApprove,
  isApproving,
  items,
}: DistributionLetterWidgetProps) {
  const [comment, setComment] = useState('')

  const handleApprove = useCallback(async () => {
    if (!distLetter) return
    await onApprove({ id: distLetter.id, comment: comment || undefined })
    setComment('')
  }, [onApprove, distLetter, comment])

  if (!distLetter) {
    return (
      <div className="rounded-lg border border-border p-6">
        <div className="flex items-center gap-3">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              Распределительное письмо
            </h3>
            <p className="text-sm text-muted-foreground">
              Распределительное письмо ещё не создано для данной заявки.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const statusLabel = DIST_STATUS_LABELS[distLetter.status] ?? distLetter.status

  // Build dual approval track
  const rpApproved =
    distLetter.status === 'rp_approved' ||
    distLetter.status === 'obs_review' ||
    distLetter.status === 'obs_approved'
  const obsApproved = distLetter.status === 'obs_approved'
  const isPendingRp = distLetter.status === 'rp_review'
  const isPendingObs = distLetter.status === 'obs_review'

  const approvalSteps = [
    {
      label: 'Создание распред. письма',
      status: 'approved' as const,
      date: formatDate(distLetter.created_at),
    },
    {
      label: 'Утверждение РП (руководитель проекта)',
      status: rpApproved
        ? ('approved' as const)
        : isPendingRp
          ? ('current' as const)
          : ('pending' as const),
      date: rpApproved ? formatDate(distLetter.rp_approved_at) : undefined,
      user: distLetter.rp_approved_by ?? undefined,
    },
    {
      label: 'Утверждение ОБС (финансы)',
      status: obsApproved
        ? ('approved' as const)
        : isPendingObs
          ? ('current' as const)
          : ('pending' as const),
      date: obsApproved ? formatDate(distLetter.obs_approved_at) : undefined,
      user: distLetter.obs_approved_by ?? undefined,
    },
  ]

  const canApprove = isPendingRp || isPendingObs

  return (
    <div className="rounded-lg border border-border p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <FileText className="h-5 w-5 text-purple-500" />
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              Распределительное письмо
            </h3>
            <div className="mt-1 flex items-center gap-2">
              <StatusBadge status={statusLabel} />
            </div>
          </div>
        </div>
        {canApprove && (
          <ApproveButton onClick={handleApprove} loading={isApproving} />
        )}
      </div>

      {/* Items in the letter */}
      {items.length > 0 && (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
                  Материал
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
                  Ед.
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted-foreground">
                  Кол-во
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-border transition-colors hover:bg-muted/50"
                >
                  <td className="px-4 py-3 text-foreground">
                    {item.material?.name ?? '\u2014'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{item.unit}</td>
                  <td className="px-4 py-3 text-right text-foreground">
                    {new Intl.NumberFormat('ru-RU').format(item.quantity)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Dual approval flow */}
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
