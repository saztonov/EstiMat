'use client'

import { useCallback, useRef, useState, type DragEvent, type ChangeEvent } from 'react'
import { Upload, FileIcon, Loader2 } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

interface FileUploaderProps {
  onUpload: (files: File[]) => void
  accept?: string
  maxSize?: number
  multiple?: boolean
  isUploading?: boolean
  progress?: number
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

export function FileUploader({
  onUpload,
  accept,
  maxSize,
  multiple = false,
  isUploading = false,
  progress,
}: FileUploaderProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const validateAndUpload = useCallback(
    (files: File[]) => {
      setError(null)

      if (files.length === 0) return

      if (maxSize) {
        const oversized = files.find((f) => f.size > maxSize)
        if (oversized) {
          setError(
            `Файл "${oversized.name}" превышает максимальный размер ${formatFileSize(maxSize)}`
          )
          return
        }
      }

      onUpload(files)
    },
    [maxSize, onUpload]
  )

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)

      if (isUploading) return

      const droppedFiles = Array.from(e.dataTransfer.files)
      const filesToUpload = multiple ? droppedFiles : droppedFiles.slice(0, 1)
      validateAndUpload(filesToUpload)
    },
    [isUploading, multiple, validateAndUpload]
  )

  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (isUploading || !e.target.files) return

      const selectedFiles = Array.from(e.target.files)
      validateAndUpload(selectedFiles)

      // Reset input so the same file can be selected again
      e.target.value = ''
    },
    [isUploading, validateAndUpload]
  )

  const handleClick = useCallback(() => {
    if (!isUploading) {
      inputRef.current?.click()
    }
  }, [isUploading])

  const acceptHint = accept
    ? accept
        .split(',')
        .map((a) => a.trim().replace('.', '').toUpperCase())
        .join(', ')
    : null

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleClick()
          }
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'relative flex min-h-[160px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors',
          isDragOver
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50',
          isUploading && 'pointer-events-none opacity-60'
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleInputChange}
          className="sr-only"
          tabIndex={-1}
        />

        {isUploading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-sm font-medium text-muted-foreground">Загрузка...</p>
            {progress != null && (
              <div className="w-full max-w-xs">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                  />
                </div>
                <p className="mt-1 text-center text-xs text-muted-foreground">
                  {Math.round(progress)}%
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            {isDragOver ? (
              <FileIcon className="h-10 w-10 text-primary" />
            ) : (
              <Upload className="h-10 w-10 text-muted-foreground" />
            )}
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">
                Перетащите файлы сюда или нажмите для выбора
              </p>
              <div className="mt-1 space-y-0.5">
                {acceptHint && (
                  <p className="text-xs text-muted-foreground">
                    Допустимые форматы: {acceptHint}
                  </p>
                )}
                {maxSize && (
                  <p className="text-xs text-muted-foreground">
                    Максимальный размер: {formatFileSize(maxSize)}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  )
}
