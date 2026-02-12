'use client'

import { useCallback, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { useApproveVolume, useVerifyVolume } from '@/entities/volume'
import { useApproveBoq } from '@/entities/boq'
import { useApproveEstimate } from '@/entities/estimate'
import { useApproveRequest } from '@/entities/request'
import { ApproveButton, RejectButton } from './approve-buttons'

type EntityType = 'boq' | 'estimate' | 'request' | 'volume'

interface ApproveDialogProps {
  entityType: EntityType
  entityId: string
  currentStatus: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

const ENTITY_LABELS: Record<EntityType, string> = {
  boq: 'ВОР',
  estimate: 'Смета',
  request: 'Заявка',
  volume: 'Том РД',
}

export function ApproveDialog({
  entityType,
  entityId,
  currentStatus,
  open,
  onOpenChange,
  onSuccess,
}: ApproveDialogProps) {
  const [comment, setComment] = useState('')
  const [action, setAction] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const approveVolume = useApproveVolume()
  const verifyVolume = useVerifyVolume()
  const approveBoq = useApproveBoq()
  const approveEstimate = useApproveEstimate()
  const approveRequest = useApproveRequest()

  const isPending =
    approveVolume.isPending ||
    verifyVolume.isPending ||
    approveBoq.isPending ||
    approveEstimate.isPending ||
    approveRequest.isPending

  const handleClose = useCallback(() => {
    setComment('')
    setAction(null)
    setError(null)
    onOpenChange(false)
  }, [onOpenChange])

  const executeMutation = useCallback(
    async (actionType: 'approve' | 'reject') => {
      setAction(actionType)
      setError(null)

      const payload = {
        id: entityId,
        comment: actionType === 'reject' ? comment : comment || undefined,
      }

      try {
        switch (entityType) {
          case 'volume':
            if (actionType === 'approve') {
              await approveVolume.mutateAsync(payload)
            } else {
              // For rejection, use verify with rejection comment
              await verifyVolume.mutateAsync({
                id: entityId,
                comment: comment || 'Отклонено',
              })
            }
            break
          case 'boq':
            await approveBoq.mutateAsync({
              id: entityId,
              comment: actionType === 'reject' ? (comment || 'Отклонено') : comment,
            })
            break
          case 'estimate':
            await approveEstimate.mutateAsync({
              id: entityId,
              comment: actionType === 'reject' ? (comment || 'Отклонено') : comment,
            })
            break
          case 'request':
            await approveRequest.mutateAsync({
              id: entityId,
              comment: actionType === 'reject' ? (comment || 'Отклонено') : comment,
            })
            break
        }

        onSuccess?.()
        handleClose()
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Не удалось выполнить операцию'
        setError(message)
      } finally {
        setAction(null)
      }
    },
    [
      entityType,
      entityId,
      comment,
      approveVolume,
      verifyVolume,
      approveBoq,
      approveEstimate,
      approveRequest,
      onSuccess,
      handleClose,
    ]
  )

  const handleApprove = useCallback(() => {
    executeMutation('approve')
  }, [executeMutation])

  const handleReject = useCallback(() => {
    if (!comment.trim()) {
      setError('Укажите причину отклонения')
      return
    }
    executeMutation('reject')
  }, [executeMutation, comment])

  if (!open) return null

  const entityLabel = ENTITY_LABELS[entityType]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50"
        onClick={handleClose}
        onKeyDown={(e) => {
          if (e.key === 'Escape') handleClose()
        }}
        role="button"
        tabIndex={0}
        aria-label="Закрыть диалог"
      />

      {/* Dialog */}
      <div className="relative z-50 w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-xl">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            Согласование: {entityLabel}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Current status */}
        <div className="mb-4 rounded-md bg-muted p-3">
          <p className="text-sm text-muted-foreground">
            Текущий статус:{' '}
            <span className="font-medium text-foreground">{currentStatus}</span>
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Comment field */}
        <div className="mb-6 space-y-2">
          <label
            htmlFor="approve-comment"
            className="text-sm font-medium text-foreground"
          >
            Комментарий{' '}
            <span className="text-xs text-muted-foreground">
              (обязателен при отклонении)
            </span>
          </label>
          <textarea
            id="approve-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Введите комментарий..."
            rows={3}
            disabled={isPending}
            className={cn(
              'flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors',
              'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <RejectButton
            onClick={handleReject}
            loading={action === 'reject' && isPending}
            disabled={isPending}
          />
          <ApproveButton
            onClick={handleApprove}
            loading={action === 'approve' && isPending}
            disabled={isPending}
          />
        </div>
      </div>
    </div>
  )
}
