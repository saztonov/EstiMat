'use client'

import { Building2, Phone, Mail, MapPin } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { OrgBadge } from './org-badge'
import type { Organization } from '../types'

interface OrgCardProps {
  organization: Organization
  onClick?: () => void
  className?: string
}

export function OrgCard({ organization, onClick, className }: OrgCardProps) {
  const { name, type, inn, contacts, address } = organization

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card p-4 shadow-sm transition-colors',
        onClick && 'cursor-pointer hover:bg-accent/50',
        className
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {name}
            </h3>
            {inn && (
              <p className="text-xs text-muted-foreground">
                ИНН: {inn}
              </p>
            )}
          </div>
        </div>
        <OrgBadge type={type} />
      </div>

      <div className="mt-3 space-y-1.5">
        {contacts?.phone && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Phone className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{contacts.phone}</span>
          </div>
        )}
        {contacts?.email && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Mail className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{contacts.email}</span>
          </div>
        )}
        {address && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{address}</span>
          </div>
        )}
      </div>
    </div>
  )
}
