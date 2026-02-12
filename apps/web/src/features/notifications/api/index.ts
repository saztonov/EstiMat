'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiResponse } from '@/shared/types/api'

export interface Notification {
  id: string
  user_id: string
  type: string
  title: string
  message: string
  link?: string | null
  is_read: boolean
  created_at: string
}

interface NotificationsResponse {
  data: Notification[]
  total: number
  unread_count: number
}

export const notificationKeys = {
  all: ['notifications'] as const,
  list: (userId: string) => [...notificationKeys.all, 'list', userId] as const,
  unreadCount: (userId: string) =>
    [...notificationKeys.all, 'unread-count', userId] as const,
}

/**
 * Fetch all notifications for a user.
 */
export function useNotifications(userId: string) {
  return useQuery<Notification[]>({
    queryKey: notificationKeys.list(userId),
    queryFn: async () => {
      const params = new URLSearchParams({ user_id: userId })
      const res = await fetch(`/api/v1/notifications?${params.toString()}`)

      if (!res.ok) {
        const body: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(
          body.error?.message ?? 'Не удалось загрузить уведомления'
        )
      }

      const body: ApiResponse<NotificationsResponse> = await res.json()
      return body.data?.data ?? []
    },
    enabled: !!userId,
  })
}

/**
 * Fetch the unread notification count for a user.
 */
export function useUnreadCount(userId: string) {
  return useQuery<number>({
    queryKey: notificationKeys.unreadCount(userId),
    queryFn: async () => {
      const params = new URLSearchParams({
        user_id: userId,
        count_only: 'true',
      })
      const res = await fetch(`/api/v1/notifications?${params.toString()}`)

      if (!res.ok) {
        const body: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(
          body.error?.message ?? 'Не удалось загрузить количество уведомлений'
        )
      }

      const body: ApiResponse<{ unread_count: number }> = await res.json()
      return body.data?.unread_count ?? 0
    },
    enabled: !!userId,
    refetchInterval: 30_000, // Poll every 30 seconds
  })
}

/**
 * Mark a single notification as read.
 */
export function useMarkAsRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (notificationId: string): Promise<void> => {
      const res = await fetch(`/api/v1/notifications/${notificationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_read: true }),
      })

      if (!res.ok) {
        const body: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(
          body.error?.message ?? 'Не удалось отметить уведомление'
        )
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all })
    },
  })
}

/**
 * Mark all notifications as read.
 */
export function useMarkAllAsRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (): Promise<void> => {
      const res = await fetch('/api/v1/notifications/read-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!res.ok) {
        const body: ApiResponse<never> = await res.json().catch(() => ({}))
        throw new Error(
          body.error?.message ?? 'Не удалось отметить все уведомления'
        )
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all })
    },
  })
}
