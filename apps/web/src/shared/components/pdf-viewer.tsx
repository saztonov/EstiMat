'use client'

import { Download } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

interface PdfViewerProps {
  url: string
  title?: string
}

export function PdfViewer({ url, title }: PdfViewerProps) {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border">
      {/* Header with title and download */}
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2">
        <span className="truncate text-sm font-medium text-foreground">
          {title ?? 'Документ PDF'}
        </span>
        <a
          href={url}
          download
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium transition-colors',
            'hover:bg-accent hover:text-accent-foreground',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
          )}
        >
          <Download className="h-3.5 w-3.5" />
          Скачать
        </a>
      </div>

      {/* PDF iframe */}
      <iframe
        src={url}
        title={title ?? 'PDF документ'}
        className="h-[600px] w-full border-0 bg-white"
        loading="lazy"
      />
    </div>
  )
}
