'use client'

import { useCallback, useState, type FormEvent } from 'react'
import { Loader2, X } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { FileUploader } from '@/shared/components'
import { useUploadVolume } from '../model'

interface UploadVolumeDialogProps {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UploadVolumeDialog({
  projectId,
  open,
  onOpenChange,
}: UploadVolumeDialogProps) {
  const {
    title,
    setTitle,
    code,
    setCode,
    file,
    setFile,
    isSubmitting,
    error,
    reset,
    submit,
  } = useUploadVolume(projectId)

  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const handleClose = useCallback(() => {
    reset()
    setSuccessMessage(null)
    onOpenChange(false)
  }, [reset, onOpenChange])

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      try {
        await submit()
        setSuccessMessage('Том РД успешно загружен')
        setTimeout(() => {
          handleClose()
        }, 1200)
      } catch {
        // Error is handled via the hook's error state
      }
    },
    [submit, handleClose]
  )

  const handleFileUpload = useCallback(
    (files: File[]) => {
      if (files.length > 0) {
        setFile(files[0])
      }
    },
    [setFile]
  )

  if (!open) return null

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
      <div className="relative z-50 w-full max-w-lg rounded-lg border border-border bg-background p-6 shadow-xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            Загрузить том РД
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Success message */}
        {successMessage && (
          <div className="mb-4 rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
            {successMessage}
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div className="space-y-2">
            <label
              htmlFor="volume-title"
              className="text-sm font-medium text-foreground"
            >
              Наименование тома <span className="text-destructive">*</span>
            </label>
            <input
              id="volume-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Том 1 - Архитектурные решения"
              disabled={isSubmitting}
              className={cn(
                'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors',
                'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            />
          </div>

          {/* Code */}
          <div className="space-y-2">
            <label
              htmlFor="volume-code"
              className="text-sm font-medium text-foreground"
            >
              Шифр тома
            </label>
            <input
              id="volume-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Например: АР-001"
              disabled={isSubmitting}
              className={cn(
                'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors',
                'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            />
          </div>

          {/* File upload */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Файл <span className="text-destructive">*</span>
            </label>

            {file ? (
              <div className="flex items-center justify-between rounded-md border border-border bg-muted/50 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / (1024 * 1024)).toFixed(2)} МБ
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  disabled={isSubmitting}
                  className="ml-2 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <FileUploader
                onUpload={handleFileUpload}
                accept=".pdf,.dwg,.dxf,.doc,.docx,.xls,.xlsx"
                maxSize={200 * 1024 * 1024}
                isUploading={isSubmitting}
              />
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className={cn(
                'inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm transition-colors',
                'hover:bg-accent hover:text-accent-foreground',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !title.trim() || !file}
              className={cn(
                'inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors',
                'hover:bg-primary/90',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Загрузить
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
