'use client'

import { useState, useMemo, useCallback } from 'react'
import { useMaterials } from '../api/queries'
import { useDebounce } from '@/shared/lib/use-debounce'

export function useMaterialsWithSearch(defaultGroupId?: string) {
  const [search, setSearch] = useState('')
  const [groupId, setGroupId] = useState<string | undefined>(defaultGroupId)

  const debouncedSearch = useDebounce(search, 300)

  const params = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      group_id: groupId || undefined,
    }),
    [debouncedSearch, groupId]
  )

  const query = useMaterials(params)

  const handleSearch = useCallback((value: string) => {
    setSearch(value)
  }, [])

  const handleGroupChange = useCallback((value: string | undefined) => {
    setGroupId(value)
  }, [])

  return {
    ...query,
    search,
    groupId,
    setSearch: handleSearch,
    setGroupId: handleGroupChange,
  }
}
