'use client'

import Link from 'next/link'
import {
  Building2,
  Users,
  Package,
  MapPin,
  ChevronRight,
  Shield,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { PageHeader } from '@/shared/components'

const ADMIN_SECTIONS = [
  {
    title: 'Организации',
    description: 'Управление организациями, подрядчиками и поставщиками',
    href: '/admin/organizations',
    icon: Building2,
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-100 dark:bg-blue-950',
  },
  {
    title: 'Пользователи',
    description: 'Управление учётными записями и ролями пользователей',
    href: '/admin/users',
    icon: Users,
    color: 'text-violet-600 dark:text-violet-400',
    bg: 'bg-violet-100 dark:bg-violet-950',
  },
  {
    title: 'Справочник материалов',
    description: 'Каталог материалов, группы и единицы измерения',
    href: '/admin/materials',
    icon: Package,
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-100 dark:bg-amber-950',
  },
  {
    title: 'Объекты',
    description: 'Строительные площадки, склады и объекты',
    href: '/admin/sites',
    icon: MapPin,
    color: 'text-green-600 dark:text-green-400',
    bg: 'bg-green-100 dark:bg-green-950',
  },
] as const

export default function AdminPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Администрирование"
        description="Управление справочниками и настройками системы"
        breadcrumbs={[
          { label: 'Главная', href: '/' },
          { label: 'Администрирование' },
        ]}
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 dark:bg-amber-950 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
            <Shield className="h-3.5 w-3.5" />
            Администратор
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {ADMIN_SECTIONS.map((section) => {
          const Icon = section.icon
          return (
            <Link
              key={section.href}
              href={section.href}
              className={cn(
                'group flex items-start gap-4 rounded-lg border border-border bg-card p-5 transition-all',
                'hover:border-primary/30 hover:shadow-md'
              )}
            >
              <div
                className={cn(
                  'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
                  section.bg
                )}
              >
                <Icon className={cn('h-5 w-5', section.color)} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                    {section.title}
                  </h3>
                  <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {section.description}
                </p>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
