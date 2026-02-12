'use client'

import { FileText, ExternalLink } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import type { RdVolumeWithRelations } from '../types'
import { VolumeStatusBadge } from './volume-status-badge'

interface VolumeRowProps {
  volume: RdVolumeWithRelations
  onClick?: (volume: RdVolumeWithRelations) => void
  className?: string
}

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

export function VolumeRow({ volume, onClick, className }: VolumeRowProps) {
  return (
    <tr
      className={cn(
        'border-b border-border transition-colors hover:bg-muted/50',
        onClick && 'cursor-pointer',
        className
      )}
      onClick={() => onClick?.(volume)}
    >
      {/* Код тома */}
      <td className="px-4 py-3 text-sm font-medium text-foreground">
        {volume.code ?? '\u2014'}
      </td>

      {/* Название */}
      <td className="px-4 py-3 text-sm text-foreground">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate max-w-[300px]">{volume.title}</span>
        </div>
      </td>

      {/* Статус */}
      <td className="px-4 py-3">
        <VolumeStatusBadge status={volume.status} />
      </td>

      {/* Файл */}
      <td className="px-4 py-3 text-sm">
        {volume.file_path ? (
          <a
            href={volume.file_path}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span>{formatFileSize(volume.file_size_bytes)}</span>
          </a>
        ) : (
          <span className="text-muted-foreground">{'\u2014'}</span>
        )}
      </td>

      {/* Дата загрузки */}
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {formatDate(volume.uploaded_at)}
      </td>

      {/* Дата проверки */}
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {formatDate(volume.verified_at)}
      </td>
    </tr>
  )
}
