'use client'

import { useCallback, useMemo } from 'react'
import {
  Bell,
  FileCheck,
  Package,
  ClipboardList,
  AlertTriangle,
  Info,
  CheckCheck,
  Loader2,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import {
  useNotifications,
  useMarkAsRead,
  useMarkAllAsRead,
  type Notification,
} from '../api'

interface NotificationDropdownProps {
  userId: string
  onClose?: () => void
}

const NOTIFICATION_ICONS: Record<string, typeof Bell> = {
  approval: FileCheck,
  delivery: Package,
  request: ClipboardList,
  warning: AlertTriangle,
  info: Info,
}

function formatTimeAgo(dateString: string): string {
  const now = Date.now()
  const date = new Date(dateString).getTime()
  const diffMs = now - date

  const seconds = Math.floor(diffMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) {
    if (days === 1) return '1 день назад'
    if (days < 5) return `${days} дня назад`
    return `${days} дней назад`
  }

  if (hours > 0) {
    if (hours === 1) return '1 час назад'
    if (hours < 5) return `${hours} часа назад`
    return `${hours} часов назад`
  }

  if (minutes > 0) {
    if (minutes === 1) return '1 минуту назад'
    if (minutes < 5) return `${minutes} минуты назад`
    return `${minutes} минут назад`
  }

  return 'Только что'
}

export function NotificationDropdown({
  userId,
  onClose,
}: NotificationDropdownProps) {
  const { data: notifications = [], isLoading } = useNotifications(userId)
  const markAsRead = useMarkAsRead()
  const markAllAsRead = useMarkAllAsRead()

  const unreadNotifications = useMemo(
    () => notifications.filter((n) => !n.is_read),
    [notifications]
  )

  const handleMarkAsRead = useCallback(
    (notification: Notification) => {
      if (notification.is_read) return
      markAsRead.mutate(notification.id)
    },
    [markAsRead]
  )

  const handleMarkAllAsRead = useCallback(() => {
    markAllAsRead.mutate()
  }, [markAllAsRead])

  const handleNotificationClick = useCallback(
    (notification: Notification) => {
      handleMarkAsRead(notification)

      if (notification.link) {
        window.location.href = notification.link
        onClose?.()
      }
    },
    [handleMarkAsRead, onClose]
  )

  return (
    <div className="w-96 rounded-lg border border-border bg-popover shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Уведомления</h3>
        {unreadNotifications.length > 0 && (
          <button
            type="button"
            onClick={handleMarkAllAsRead}
            disabled={markAllAsRead.isPending}
            className={cn(
              'inline-flex items-center gap-1.5 text-xs font-medium text-primary transition-colors',
              'hover:text-primary/80',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {markAllAsRead.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <CheckCheck className="h-3 w-3" />
            )}
            Отметить все как прочитанные
          </button>
        )}
      </div>

      {/* List */}
      <div className="max-h-96 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">
              Загрузка...
            </span>
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8">
            <Bell className="h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              Нет уведомлений
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {notifications.map((notification) => {
              const IconComponent =
                NOTIFICATION_ICONS[notification.type] ?? Info

              return (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => handleNotificationClick(notification)}
                  className={cn(
                    'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                    'hover:bg-muted/50',
                    !notification.is_read && 'bg-primary/5'
                  )}
                >
                  {/* Icon */}
                  <div
                    className={cn(
                      'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                      notification.is_read
                        ? 'bg-muted text-muted-foreground'
                        : 'bg-primary/10 text-primary'
                    )}
                  >
                    <IconComponent className="h-4 w-4" />
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'text-sm',
                        notification.is_read
                          ? 'text-muted-foreground'
                          : 'font-medium text-foreground'
                      )}
                    >
                      {notification.title}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {notification.message}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground/70">
                      {formatTimeAgo(notification.created_at)}
                    </p>
                  </div>

                  {/* Unread indicator */}
                  {!notification.is_read && (
                    <div className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
