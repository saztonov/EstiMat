'use client'

import { cn } from '@/shared/lib/utils'

interface UserAvatarProps {
  fullName: string
  imageUrl?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeClasses = {
  sm: 'h-7 w-7 text-xs',
  md: 'h-9 w-9 text-sm',
  lg: 'h-12 w-12 text-base',
}

function getInitials(fullName: string): string {
  if (!fullName) return '?'

  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase()
  }
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

/**
 * Deterministic color based on the name string.
 * Uses simple hash to pick from a palette.
 */
const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-green-500',
  'bg-purple-500',
  'bg-orange-500',
  'bg-cyan-500',
  'bg-pink-500',
  'bg-amber-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-rose-500',
]

function getColorFromName(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length
  return AVATAR_COLORS[index]
}

export function UserAvatar({
  fullName,
  imageUrl,
  size = 'md',
  className,
}: UserAvatarProps) {
  const initials = getInitials(fullName)
  const colorClass = getColorFromName(fullName)

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={fullName}
        className={cn(
          'shrink-0 rounded-full object-cover',
          sizeClasses[size],
          className
        )}
      />
    )
  }

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-medium text-white',
        sizeClasses[size],
        colorClass,
        className
      )}
      title={fullName}
    >
      {initials}
    </div>
  )
}
