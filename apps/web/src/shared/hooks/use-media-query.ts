'use client'

import { useEffect, useState } from 'react'

/**
 * Tracks whether the given CSS media query matches.
 * Returns `false` during SSR and on initial render to avoid hydration mismatches,
 * then syncs with the actual media query state on the client.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const mediaQueryList = window.matchMedia(query)

    // Set the initial value
    setMatches(mediaQueryList.matches)

    function handleChange(event: MediaQueryListEvent) {
      setMatches(event.matches)
    }

    mediaQueryList.addEventListener('change', handleChange)

    return () => {
      mediaQueryList.removeEventListener('change', handleChange)
    }
  }, [query])

  return matches
}
