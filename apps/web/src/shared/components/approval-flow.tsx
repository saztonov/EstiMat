import { cn } from '@/shared/lib/utils'
import { Check, X, Clock, CircleDot } from 'lucide-react'

interface ApprovalStep {
  label: string
  status: 'pending' | 'approved' | 'rejected' | 'current'
  user?: string
  date?: string
  comment?: string
}

interface ApprovalFlowProps {
  steps: ApprovalStep[]
}

const statusConfig = {
  approved: {
    dotColor: 'bg-green-500',
    lineColor: 'bg-green-500',
    icon: Check,
    iconColor: 'text-white',
  },
  rejected: {
    dotColor: 'bg-red-500',
    lineColor: 'bg-red-500',
    icon: X,
    iconColor: 'text-white',
  },
  current: {
    dotColor: 'bg-blue-500',
    lineColor: 'bg-border',
    icon: CircleDot,
    iconColor: 'text-white',
  },
  pending: {
    dotColor: 'bg-gray-300 dark:bg-gray-600',
    lineColor: 'bg-border',
    icon: Clock,
    iconColor: 'text-gray-500 dark:text-gray-400',
  },
} as const

export function ApprovalFlow({ steps }: ApprovalFlowProps) {
  if (steps.length === 0) return null

  return (
    <div className="space-y-0">
      {steps.map((step, index) => {
        const config = statusConfig[step.status]
        const Icon = config.icon
        const isLast = index === steps.length - 1

        return (
          <div key={index} className="relative flex gap-3">
            {/* Vertical line + dot */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full',
                  config.dotColor
                )}
              >
                <Icon
                  className={cn('h-3.5 w-3.5', config.iconColor)}
                />
              </div>
              {!isLast && (
                <div
                  className={cn(
                    'w-0.5 flex-1 min-h-[24px]',
                    config.lineColor
                  )}
                />
              )}
            </div>

            {/* Content */}
            <div className={cn('pb-6', isLast && 'pb-0')}>
              <p
                className={cn(
                  'text-sm font-medium leading-7',
                  step.status === 'pending' && 'text-muted-foreground',
                  step.status === 'current' && 'text-blue-600 dark:text-blue-400',
                  step.status === 'approved' && 'text-foreground',
                  step.status === 'rejected' && 'text-foreground'
                )}
              >
                {step.label}
              </p>

              {(step.user || step.date) && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {step.user && <span>{step.user}</span>}
                  {step.user && step.date && <span> &mdash; </span>}
                  {step.date && <span>{step.date}</span>}
                </p>
              )}

              {step.comment && (
                <p className="mt-1 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground italic">
                  {step.comment}
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
