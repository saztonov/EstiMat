'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Loader2, ArrowLeft, Link as LinkIcon } from 'lucide-react'
import { PageHeader, ApprovalFlow } from '@/shared/components'
import {
  useEstimateDetail,
  EstimateStatusBadge,
  type EstimateItemWithRelations,
} from '@/entities/estimate'
import { InlineEditableCell } from '@/features/inline-edit'
import { ApproveButton, RejectButton } from '@/features/approve-entity'
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

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export function EstimateDetailWidget() {
  const router = useRouter()
  const params = useParams<{ id: string; estimateId: string }>()
  const projectId = params.id
  const estimateId = params.estimateId

  const {
    detail,
    items,
    approve,
    updateItem,
  } = useEstimateDetail(estimateId)

  const [approveDialogOpen, setApproveDialogOpen] = useState(false)
  const [approveAction, setApproveAction] = useState<'approve' | 'reject'>('approve')
  const [approveComment, setApproveComment] = useState('')

  const estimate = detail.data
  const estimateItems = items.data ?? []
  const isLoading = detail.isLoading || items.isLoading

  // Recalculate totals from items
  const computedTotal = useMemo(
    () =>
      estimateItems.reduce(
        (sum, item) => sum + (item.quantity ?? 0) * (item.unit_price ?? 0),
        0
      ),
    [estimateItems]
  )

  // Handle inline price edit
  const handlePriceUpdate = useCallback(
    async (item: EstimateItemWithRelations, newPrice: number) => {
      await updateItem.mutateAsync({
        id: item.id,
        estimateId,
        unit_price: newPrice,
      })
    },
    [updateItem, estimateId]
  )

  // Handle approve/reject
  const handleApproveAction = useCallback(async () => {
    if (approveAction === 'approve') {
      await approve.mutateAsync({ id: estimateId, comment: approveComment || undefined })
    }
    setApproveDialogOpen(false)
    setApproveComment('')
  }, [approve, approveAction, approveComment, estimateId])

  // Build approval flow steps
  const approvalSteps = useMemo(() => {
    if (!estimate) return []
    const steps = []

    steps.push({
      label: 'Создание сметы',
      status: 'approved' as const,
      date: formatDate(estimate.created_at),
    })

    if (estimate.status === 'review') {
      steps.push({
        label: 'На проверке',
        status: 'current' as const,
      })
      steps.push({
        label: 'Утверждение',
        status: 'pending' as const,
      })
    } else if (estimate.status === 'approved') {
      steps.push({
        label: 'Проверка пройдена',
        status: 'approved' as const,
      })
      steps.push({
        label: 'Утверждена',
        status: 'approved' as const,
        date: formatDate(estimate.approved_at),
      })
    } else if (estimate.status === 'draft') {
      steps.push({
        label: 'Отправка на проверку',
        status: 'pending' as const,
      })
    }

    return steps
  }, [estimate])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Загрузка сметы...</span>
      </div>
    )
  }

  if (!estimate) {
    return (
      <div className="py-20 text-center">
        <p className="text-muted-foreground">Смета не найдена</p>
      </div>
    )
  }

  const canApprove = estimate.status === 'review'
  const canEdit = estimate.status === 'draft' || estimate.status === 'review'

  return (
    <div className="space-y-6">
      <PageHeader
        title={estimate.work_type ?? `Смета #${estimate.id.slice(0, 8)}`}
        breadcrumbs={[
          { label: 'Проекты', href: '/projects' },
          { label: 'Проект', href: `/projects/${projectId}` },
          { label: 'Сметы', href: `/projects/${projectId}/estimates` },
          { label: estimate.work_type ?? `#${estimate.id.slice(0, 8)}` },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push(`/projects/${projectId}/estimates`)}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-input px-4 text-sm font-medium transition-colors hover:bg-accent"
            >
              <ArrowLeft className="h-4 w-4" />
              К списку
            </button>
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

      {/* Estimate info header */}
      <div className="rounded-lg border border-border p-6">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Номер</p>
            <p className="text-sm font-medium text-foreground">
              #{estimate.id.slice(0, 8)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Подрядчик</p>
            <p className="text-sm font-medium text-foreground">
              {estimate.contractor?.name ?? '\u2014'}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Статус</p>
            <div className="mt-1">
              <EstimateStatusBadge status={estimate.status} />
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Общая сумма</p>
            <p className="text-sm font-bold text-foreground">
              {formatCurrency(computedTotal)}
            </p>
          </div>
        </div>
      </div>

      {/* Items table */}
      <div>
        <h3 className="mb-4 text-lg font-semibold text-foreground">
          Позиции сметы
        </h3>
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
                  Наименование
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">
                  Ед. изм.
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted-foreground">
                  Кол-во
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted-foreground">
                  Цена за ед.
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted-foreground">
                  Итого
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase text-muted-foreground">
                  ВОР
                </th>
              </tr>
            </thead>
            <tbody>
              {estimateItems.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    Нет позиций
                  </td>
                </tr>
              ) : (
                estimateItems.map((item) => {
                  const rowTotal = (item.quantity ?? 0) * (item.unit_price ?? 0)

                  return (
                    <tr
                      key={item.id}
                      className="border-b border-border transition-colors hover:bg-muted/50"
                    >
                      <td className="px-4 py-3 text-foreground">
                        {item.description ?? item.material?.name ?? '\u2014'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {item.unit}
                      </td>
                      <td className="px-4 py-3 text-right text-foreground">
                        {new Intl.NumberFormat('ru-RU').format(item.quantity ?? 0)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canEdit ? (
                          <InlineEditableCell
                            value={item.unit_price ?? 0}
                            onSave={(val) => handlePriceUpdate(item, Number(val))}
                            type="number"
                          />
                        ) : (
                          <span className="text-foreground">
                            {formatCurrency(item.unit_price)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-foreground">
                        {formatCurrency(rowTotal)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {item.boq_item_id ? (
                          <LinkIcon className="mx-auto h-4 w-4 text-blue-500" />
                        ) : (
                          <span className="text-muted-foreground">\u2014</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
            {estimateItems.length > 0 && (
              <tfoot>
                <tr className="bg-muted/30">
                  <td
                    colSpan={4}
                    className="px-4 py-3 text-right text-sm font-semibold text-foreground"
                  >
                    Итого:
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-bold text-foreground">
                    {formatCurrency(computedTotal)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

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
              {approveAction === 'approve' ? 'Утвердить смету' : 'Отклонить смету'}
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
