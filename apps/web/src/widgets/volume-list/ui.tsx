'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, Loader2, FileText, ExternalLink } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { PageHeader } from '@/shared/components/page-header'
import { DataTable, type ColumnDef } from '@/shared/components/data-table'
import {
  useVolumes,
  useCreateVolume,
  VolumeStatusBadge,
  type RdVolumeWithRelations,
} from '@/entities/volume'
import { useRealtime } from '@/shared/hooks'
import { FileUploader } from '@/shared/components/file-uploader'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface VolumeListWidgetProps {
  projectId: string
  projectName?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateString: string | null): string {
  if (!dateString) return '\u2014'
  return new Date(dateString).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '\u2014'
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export function VolumeListWidget({ projectId, projectName }: VolumeListWidgetProps) {
  const router = useRouter()

  // Realtime subscription for volumes
  useRealtime('rd_volumes', {
    filter: `project_id=eq.${projectId}`,
  })

  const { data: volumeResult, isLoading } = useVolumes(projectId)
  const volumes = volumeResult?.data ?? []

  const createVolume = useCreateVolume()

  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadCode, setUploadCode] = useState('')

  const navigateToVolume = useCallback(
    (volume: RdVolumeWithRelations) => {
      router.push(`/projects/${projectId}/volumes/${volume.id}`)
    },
    [router, projectId]
  )

  // -------------------------------------------------------------------------
  // Columns
  // -------------------------------------------------------------------------

  const columns = useMemo<ColumnDef<RdVolumeWithRelations, unknown>[]>(
    () => [
      {
        accessorKey: 'code',
        header: 'Код',
        size: 120,
        cell: ({ row }) => (
          <button
            onClick={() => navigateToVolume(row.original)}
            className="font-medium text-foreground hover:text-primary hover:underline"
          >
            {row.original.code ?? '\u2014'}
          </button>
        ),
      },
      {
        accessorKey: 'title',
        header: 'Наименование',
        cell: ({ row }) => (
          <button
            onClick={() => navigateToVolume(row.original)}
            className="flex items-center gap-2 text-left text-foreground hover:text-primary"
          >
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate max-w-[300px]">{row.original.title}</span>
          </button>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Статус',
        cell: ({ row }) => <VolumeStatusBadge status={row.original.status} />,
      },
      {
        id: 'file',
        header: 'Файл',
        cell: ({ row }) =>
          row.original.file_path ? (
            <a
              href={row.original.file_path}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>{formatFileSize(row.original.file_size_bytes)}</span>
            </a>
          ) : (
            <span className="text-muted-foreground">{'\u2014'}</span>
          ),
      },
      {
        accessorKey: 'uploaded_at',
        header: 'Дата загрузки',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatDate(row.original.uploaded_at)}
          </span>
        ),
      },
    ],
    [navigateToVolume]
  )

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div>
      <PageHeader
        title="Тома РД"
        breadcrumbs={[
          { label: 'Проекты', href: '/projects' },
          { label: projectName ?? 'Проект', href: `/projects/${projectId}` },
          { label: 'Тома РД' },
        ]}
        actions={
          <button
            onClick={() => setUploadDialogOpen(true)}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Upload className="h-4 w-4" />
            Загрузить том
          </button>
        }
      />

      <DataTable
        columns={columns}
        data={volumes}
        isLoading={isLoading}
      />

      {/* Upload Dialog */}
      {uploadDialogOpen && (
        <UploadVolumeDialog
          projectId={projectId}
          isPending={createVolume.isPending}
          title={uploadTitle}
          code={uploadCode}
          onTitleChange={setUploadTitle}
          onCodeChange={setUploadCode}
          onClose={() => {
            setUploadDialogOpen(false)
            setUploadTitle('')
            setUploadCode('')
          }}
          onUpload={(file) => {
            createVolume.mutate(
              {
                projectId,
                title: uploadTitle,
                code: uploadCode || undefined,
                file,
              },
              {
                onSuccess: () => {
                  setUploadDialogOpen(false)
                  setUploadTitle('')
                  setUploadCode('')
                },
              }
            )
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// UploadVolumeDialog
// ---------------------------------------------------------------------------

function UploadVolumeDialog({
  projectId,
  isPending,
  title,
  code,
  onTitleChange,
  onCodeChange,
  onClose,
  onUpload,
}: {
  projectId: string
  isPending: boolean
  title: string
  code: string
  onTitleChange: (v: string) => void
  onCodeChange: (v: string) => void
  onClose: () => void
  onUpload: (file: File) => void
}) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const inputCn = cn(
    'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm',
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
    'placeholder:text-muted-foreground'
  )

  const canSubmit = title.trim().length > 0 && selectedFile !== null && !isPending

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Загрузить том РД</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <span className="sr-only">Закрыть</span>
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Наименование тома *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              className={inputCn}
              placeholder="АР-001. Архитектурные решения"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Код тома</label>
            <input
              type="text"
              value={code}
              onChange={(e) => onCodeChange(e.target.value)}
              className={inputCn}
              placeholder="АР-001"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Файл *</label>
            <FileUploader
              onUpload={(files) => setSelectedFile(files[0] ?? null)}
              accept=".pdf,.dwg,.doc,.docx,.xls,.xlsx"
              maxSize={100 * 1024 * 1024}
              isUploading={isPending}
            />
            {selectedFile && (
              <p className="mt-2 text-xs text-muted-foreground">
                Выбран: {selectedFile.name} ({formatFileSize(selectedFile.size)})
              </p>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={onClose}
              className="h-9 rounded-md border border-input px-4 text-sm font-medium hover:bg-muted"
            >
              Отмена
            </button>
            <button
              onClick={() => {
                if (selectedFile) onUpload(selectedFile)
              }}
              disabled={!canSubmit}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Загрузить
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
