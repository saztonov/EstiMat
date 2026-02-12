'use client'

import { useState, useCallback } from 'react'
import {
  Download,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Loader2,
  FileText,
  Calendar,
  User,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { PageHeader } from '@/shared/components/page-header'
import { PdfViewer } from '@/shared/components/pdf-viewer'
import {
  useVolume,
  useVerifyVolume,
  useApproveVolume,
  VolumeStatusBadge,
  type RdVolumeWithRelations,
} from '@/entities/volume'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface VolumeDetailWidgetProps {
  projectId: string
  volumeId: string
  projectName?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '\u2014'
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '\u2014'
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

function isPdfFile(filePath: string | null): boolean {
  if (!filePath) return false
  return filePath.toLowerCase().endsWith('.pdf')
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export function VolumeDetailWidget({ projectId, volumeId, projectName }: VolumeDetailWidgetProps) {
  const { data: volume, isLoading } = useVolume(volumeId)
  const verifyVolume = useVerifyVolume()
  const approveVolume = useApproveVolume()

  const [actionDialogType, setActionDialogType] = useState<'verify' | 'approve' | 'reject' | null>(null)

  const handleAction = useCallback(
    (comment?: string) => {
      if (!volume) return

      if (actionDialogType === 'verify') {
        verifyVolume.mutate(
          { id: volume.id, comment },
          { onSuccess: () => setActionDialogType(null) }
        )
      } else if (actionDialogType === 'approve') {
        approveVolume.mutate(
          { id: volume.id, comment },
          { onSuccess: () => setActionDialogType(null) }
        )
      } else if (actionDialogType === 'reject') {
        // Reject via verify with rejection comment
        verifyVolume.mutate(
          { id: volume.id, comment: comment ?? 'Отклонено' },
          { onSuccess: () => setActionDialogType(null) }
        )
      }
    },
    [volume, actionDialogType, verifyVolume, approveVolume]
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Загрузка тома...</span>
      </div>
    )
  }

  if (!volume) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-muted-foreground">Том не найден</p>
      </div>
    )
  }

  const downloadUrl = `/api/v1/volumes/${volume.id}/download`

  return (
    <div>
      <PageHeader
        title={volume.title}
        breadcrumbs={[
          { label: 'Проекты', href: '/projects' },
          { label: projectName ?? 'Проект', href: `/projects/${projectId}` },
          { label: 'Тома РД', href: `/projects/${projectId}/volumes` },
          { label: volume.code ?? volume.title },
        ]}
        actions={
          <div className="flex items-center gap-2">
            {/* Download */}
            <a
              href={downloadUrl}
              download
              className="inline-flex h-9 items-center gap-2 rounded-md border border-input px-4 text-sm font-medium hover:bg-muted"
            >
              <Download className="h-4 w-4" />
              Скачать
            </a>

            {/* Verify */}
            {volume.status === 'uploaded' && (
              <button
                onClick={() => setActionDialogType('verify')}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
              >
                <CheckCircle2 className="h-4 w-4" />
                Проверить
              </button>
            )}

            {/* Approve */}
            {volume.status === 'verified' && (
              <button
                onClick={() => setActionDialogType('approve')}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-green-600 px-4 text-sm font-medium text-white hover:bg-green-700"
              >
                <ShieldCheck className="h-4 w-4" />
                Утвердить
              </button>
            )}

            {/* Reject */}
            {(volume.status === 'uploaded' || volume.status === 'verified') && (
              <button
                onClick={() => setActionDialogType('reject')}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700"
              >
                <XCircle className="h-4 w-4" />
                Отклонить
              </button>
            )}
          </div>
        }
      />

      {/* Volume info card */}
      <div className="mb-6 rounded-lg border border-border bg-card p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-xs font-medium uppercase text-muted-foreground">Статус</div>
            <div className="mt-1">
              <VolumeStatusBadge status={volume.status} />
            </div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase text-muted-foreground">Код тома</div>
            <div className="mt-1 text-sm font-medium text-foreground">{volume.code ?? '\u2014'}</div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase text-muted-foreground">Размер файла</div>
            <div className="mt-1 text-sm text-foreground">{formatFileSize(volume.file_size_bytes)}</div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase text-muted-foreground">Версия</div>
            <div className="mt-1 text-sm text-foreground">v{volume.version}</div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4 shrink-0" />
            <span>Загружен: {formatDate(volume.uploaded_at)}</span>
          </div>
          {volume.uploader && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <User className="h-4 w-4 shrink-0" />
              <span>Загрузил: {volume.uploader.full_name}</span>
            </div>
          )}
          {volume.verified_at && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>
                Проверен: {formatDate(volume.verified_at)}
                {volume.verifier ? ` (${volume.verifier.full_name})` : ''}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* PDF viewer */}
      {isPdfFile(volume.file_path) && (
        <div className="mb-6">
          <PdfViewer url={volume.file_path} title={volume.title} />
        </div>
      )}

      {/* If not PDF, show download prompt */}
      {!isPdfFile(volume.file_path) && volume.file_path && (
        <div className="mb-6 rounded-lg border border-border bg-card p-8 text-center">
          <FileText className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">
            Предпросмотр недоступен для данного формата файла
          </p>
          <a
            href={downloadUrl}
            download
            className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Download className="h-4 w-4" />
            Скачать файл
          </a>
        </div>
      )}

      {/* Action Dialog */}
      {actionDialogType && (
        <ActionDialog
          type={actionDialogType}
          isPending={verifyVolume.isPending || approveVolume.isPending}
          onClose={() => setActionDialogType(null)}
          onConfirm={handleAction}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ActionDialog
// ---------------------------------------------------------------------------

function ActionDialog({
  type,
  isPending,
  onClose,
  onConfirm,
}: {
  type: 'verify' | 'approve' | 'reject'
  isPending: boolean
  onClose: () => void
  onConfirm: (comment?: string) => void
}) {
  const [comment, setComment] = useState('')

  const titles: Record<string, string> = {
    verify: 'Проверить том',
    approve: 'Утвердить том',
    reject: 'Отклонить том',
  }

  const descriptions: Record<string, string> = {
    verify: 'Подтвердите, что том РД прошел проверку.',
    approve: 'Подтвердите утверждение тома РД.',
    reject: 'Укажите причину отклонения тома РД.',
  }

  const buttonLabels: Record<string, string> = {
    verify: 'Проверить',
    approve: 'Утвердить',
    reject: 'Отклонить',
  }

  const buttonColors: Record<string, string> = {
    verify: 'bg-blue-600 hover:bg-blue-700 text-white',
    approve: 'bg-green-600 hover:bg-green-700 text-white',
    reject: 'bg-red-600 hover:bg-red-700 text-white',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg">
        <h3 className="text-lg font-semibold text-foreground">{titles[type]}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{descriptions[type]}</p>

        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium">
            Комментарий {type === 'reject' ? '*' : '(необязательно)'}
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className={cn(
              'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm min-h-[80px]',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              'placeholder:text-muted-foreground'
            )}
            placeholder={type === 'reject' ? 'Укажите причину отклонения...' : 'Комментарий...'}
          />
        </div>

        <div className="mt-4 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="h-9 rounded-md border border-input px-4 text-sm font-medium hover:bg-muted"
          >
            Отмена
          </button>
          <button
            onClick={() => onConfirm(comment || undefined)}
            disabled={isPending || (type === 'reject' && !comment.trim())}
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-md px-4 text-sm font-medium disabled:opacity-50',
              buttonColors[type]
            )}
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {buttonLabels[type]}
          </button>
        </div>
      </div>
    </div>
  )
}
