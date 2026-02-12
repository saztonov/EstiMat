'use client'

import { useState, useMemo, useCallback } from 'react'
import { useOrganizations } from '../api/queries'
import { useDebounce } from '@/shared/lib/use-debounce'

export function useOrganizationsWithSearch(defaultType?: string) {
  const [search, setSearch] = useState('')
  const [type, setType] = useState<string | undefined>(defaultType)

  const debouncedSearch = useDebounce(search, 300)

  const params = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      type: type || undefined,
    }),
    [debouncedSearch, type]
  )

  const query = useOrganizations(params)

  const handleSearch = useCallback((value: string) => {
    setSearch(value)
  }, [])

  const handleTypeChange = useCallback((value: string | undefined) => {
    setType(value)
  }, [])

  return {
    ...query,
    search,
    type,
    setSearch: handleSearch,
    setType: handleTypeChange,
  }
}
