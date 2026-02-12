'use client'

import { useState, useEffect } from 'react'

/**
 * Debounce a value by a given delay (in ms).
 * Returns the debounced value that updates only after the specified delay
 * has passed since the last change.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(timer)
    }
  }, [value, delay])

  return debouncedValue
}
