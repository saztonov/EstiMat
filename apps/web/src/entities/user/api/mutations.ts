'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { User, CreateUserInput, UpdateUserInput } from '../types'
import { userKeys } from './queries'

export function useCreateUser() {
  const queryClient = useQueryClient()

  return useMutation<User, Error, CreateUserInput>({
    mutationFn: async (data) => {
      const res = await fetch('/api/v1/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error?.error?.message ?? 'Не удалось создать пользователя')
      }
      const json = await res.json()
      return json.data ?? json
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.all })
    },
  })
}

export function useUpdateUser() {
  const queryClient = useQueryClient()

  return useMutation<User, Error, { id: string; data: UpdateUserInput }>({
    mutationFn: async ({ id, data }) => {
      const res = await fetch(`/api/v1/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error?.error?.message ?? 'Не удалось обновить пользователя')
      }
      const json = await res.json()
      return json.data ?? json
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: userKeys.all })
      queryClient.invalidateQueries({
        queryKey: userKeys.detail(variables.id),
      })
      // Also refresh "me" since the updated user might be the current user
      queryClient.invalidateQueries({ queryKey: userKeys.me() })
    },
  })
}
