'use client'

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/shared/lib/supabase/client'

type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*'

interface UseRealtimeOptions {
  /** The Postgres change event to subscribe to. Defaults to '*' (all events). */
  event?: RealtimeEvent
  /** Optional Postgres filter expression, e.g. "project_id=eq.123" */
  filter?: string
  /** The Postgres schema to listen on. Defaults to 'public'. */
  schema?: string
}

/**
 * Subscribes to Supabase Realtime changes on a given table.
 * When an event is received, the matching TanStack Query cache
 * entries (keyed by table name) are automatically invalidated.
 */
export function useRealtime(table: string, options?: UseRealtimeOptions) {
  const queryClient = useQueryClient()

  useEffect(() => {
    const supabase = createClient()
    const event = options?.event ?? '*'
    const schema = options?.schema ?? 'public'

    const channelName = `realtime:${schema}:${table}:${event}`

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes' as never,
        {
          event,
          schema,
          table,
          ...(options?.filter ? { filter: options.filter } : {}),
        },
        () => {
          queryClient.invalidateQueries({ queryKey: [table] })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [table, options?.event, options?.filter, options?.schema, queryClient])
}
