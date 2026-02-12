'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Loader2, ArrowLeft, Send } from 'lucide-react'
import { PageHeader, ApprovalFlow, StatusBadge } from '@/shared/components'
import {
  useRequestDetail,
  RequestStatusBadge,
  FundingTypeBadge,
  type PrItemWithRelations,
} from '@/entities/request'
import { ApproveButton, RejectButton } from '@/features/approve-entity'
import { DistributionLetterWidget } from '@/widgets/distribution-letter'
import { AdvanceFormWidget } from '@/widgets/advance-form'
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

const PR_ITEM_STATUS_LABELS: Record<string, string> = {
  pending: 'Ожидает',
  in_tender: 'В тендере',
  ordered: 'Заказано',
  delivered: 'Доставлено',
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export function RequestDetailWidget() {
  const router = useRouter()
  const params = useParams<{ id: string; requestId: string }>()
  const projectId = params.id
  const requestId = params.requestId

  const {
    detail,
    items,
    distLetter,
    advance,
    submit,
    approve,
    approveDistLetter,
    approveAdvance,
  } = useRequestDetail(requestId)

  const [approveDialogOpen, setApproveDialogOpen] = useState(false)
  const [approveAction, setApproveAction] = useState<'approve' | 'reject'>('approve')
  const [approveComment, setApproveComment] = useState('')

  const request = detail.data
  const requestItems = items.data ?? []
  const isLoading = detail.isLoading || items.isLoading

  // Build approval flow steps
  const approvalSteps = useMemo(() => {
    if (!request) return []
    const steps = []

    steps.push({
      label: 'Создание заявки',
      status: 'approved' as const,
      date: formatDate(request.created_at),
    })

    if (request.status === 'draft') {
      steps.push({ label: 'Отправка на рассмотрение', status: 'pending' as const })
    } else if (request.status === 'submitted') {
      steps.push({ label: 'Отправлена', status: 'current' as const })
      steps.push({ label: 'Утверждение', status: 'pending' as const })
    } else if (request.status === 'review') {
      steps.push({ label: 'Отправлена', status: 'approved' as const })
      steps.push({ label: 'На проверке', status: 'current' as const })
    } else if (request.status === 'approved') {
      steps.push({ label: 'Отправлена', status: 'approved' as const })
      steps.push({ label: 'Утверждена', status: 'approved' as const })
    } else if (request.status === 'in_progress') {
      steps.push({ label: 'Утверждена', status: 'approved' as const })
      steps.push({ label: 'В работе', status: 'current' as const })
    } else if (request.status === 'fulfilled') {
      steps.push({ label: 'Утверждена', status: 'approved' as const })
      steps.push({ label: 'Исполнена', status: 'approved' as const })
    } else if (request.status === 'cancelled') {
      steps.push({ label: 'Отменена', status: 'rejected' as const })
    }

    return steps
  }, [request])

  // Handlers
  const handleSubmitRequest = useCallback(async () => {
    await submit.mutateAsync({ id: requestId })
  }, [submit, requestId])

  const handleApproveAction = useCallback(async () => {
    if (approveAction === 'approve') {
      await approve.mutateAsync({ id: requestId, comment: approveComment || undefined })
    }
    setApproveDialogOpen(false)
    setApproveComment('')
  }, [approve, approveAction, approveComment, requestId])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Загрузка заявки...</span>
      </div>
    )
  }

  if (!request) {
    return (
      <div className="py-20 text-center">
        <p className="text-muted-foreground">Заявка не найдена</p>
      </div>
    )
  }

  const canSubmit = request.status === 'draft'
  const canApprove = request.status === 'submitted' || request.status === 'review'

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Заявка #${request.id.slice(0, 8)}`}
        breadcrumbs={[
          { label: 'Проекты', href: '/projects' },
          { label: 'Проект', href: `/projects/${projectId}` },
          { label: 'Заявки', href: `/projects/${projectId}/requests` },
          { label: `#${request.id.slice(0, 8)}` },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push(`/projects/${projectId}/requests`)}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-input px-4 text-sm font-medium transition-colors hover:bg-accent"
            >
              <ArrowLeft className="h-4 w-4" />
              К списку
            </button>
            {canSubmit && (
              <button
                type="button"
                onClick={handleSubmitRequest}
                disabled={submit.isPending}
                className={cn(
                  'inline-flex h-9 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-medium text-white shadow transition-colors',
                  'hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                {submit.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Отправить
              </button>
            )}
            {canApprove && (
              <>
                <ApproveButton
                  onClick={() => {
                    setApproveAction('approve')
                    setApproveDialogOpen(true)
                  }}
                  loading={approve.isPending}
                />
                <RejectButton
                  onClick={() => {
                    setApproveAction('reject')
                    setApproveDialogOpen(true)
                  }}
                />
              </>
            )}
          </div>
        }
      />

      {/* Request info header */}
      <div className="rounded-lg border border-border p-6">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Тип</p>
            <div className="mt-1">
              <FundingTypeBadge fundingType={request.funding_type} />
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Статус</p>
            <div className="mt-1">
              <RequestStatusBadge status={request.status} />
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Сумма</p>
            <p className="text-sm font-bold text-foreground">
              {formatCurrency(request.total)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Дедлайн</p>
            <p className="text-sm font-medium text-foreground">
              {formatDate(request.deadline)}
            </p>
          </div>
        </div>
      </div>

      {/* Items table */}
      <div>
        <h3 className="mb-4 text-lg font-semibold text-foreground">
          Позиции заявки
        </h3>
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
                {request.funding_type === 'gp_supply' && (
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase text-muted-foreground">
                    Статус
                  </th>
                )}
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
                  Срок
                </th>
              </tr>
            </thead>
            <tbody>
              {requestItems.length === 0 ? (
                <tr>
                  <td
                    colSpan={request.funding_type === 'gp_supply' ? 5 : 4}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    Нет позиций
                  </td>
                </tr>
              ) : (
                requestItems.map((item) => (
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
                    {request.funding_type === 'gp_supply' && (
                      <td className="px-4 py-3 text-center">
                        <StatusBadge
                          status={PR_ITEM_STATUS_LABELS[item.status] ?? item.status}
                        />
                      </td>
                    )}
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(item.required_date)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Conditional panels based on funding_type */}
      {request.funding_type === 'obs_letter' && (
        <DistributionLetterWidget
          requestId={requestId}
          distLetter={distLetter.data ?? null}
          onApprove={approveDistLetter.mutateAsync}
          isApproving={approveDistLetter.isPending}
          items={requestItems}
        />
      )}

      {request.funding_type === 'advance' && (
        <AdvanceFormWidget
          requestId={requestId}
          advance={advance.data ?? null}
          onApprove={approveAdvance.mutateAsync}
          isApproving={approveAdvance.isPending}
        />
      )}

      {/* Approval flow */}
      {approvalSteps.length > 0 && (
        <div>
          <h3 className="mb-4 text-lg font-semibold text-foreground">
            Ход согласования
          </h3>
          <div className="rounded-lg border border-border p-6">
            <ApprovalFlow steps={approvalSteps} />
          </div>
        </div>
      )}

      {/* Approve/reject dialog */}
      {approveDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg">
            <h4 className="text-lg font-semibold text-foreground">
              {approveAction === 'approve' ? 'Утвердить заявку' : 'Отклонить заявку'}
            </h4>
            <div className="mt-4">
              <label className="mb-1 block text-sm font-medium text-foreground">
                Комментарий
              </label>
              <textarea
                value={approveComment}
                onChange={(e) => setApproveComment(e.target.value)}
                placeholder="Необязательный комментарий..."
                rows={3}
                className={cn(
                  'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
                )}
              />
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setApproveDialogOpen(false)
                  setApproveComment('')
                }}
                className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm font-medium transition-colors hover:bg-accent"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleApproveAction}
                disabled={approve.isPending}
                className={cn(
                  'inline-flex h-9 items-center gap-2 rounded-md px-4 text-sm font-medium text-white shadow transition-colors',
                  approveAction === 'approve'
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-red-600 hover:bg-red-700',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                {approve.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {approveAction === 'approve' ? 'Утвердить' : 'Отклонить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
