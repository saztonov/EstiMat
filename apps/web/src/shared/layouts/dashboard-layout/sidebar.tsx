'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/shared/lib/utils'
import {
  LayoutDashboard,
  FolderKanban,
  Gavel,
  ShoppingCart,
  Truck,
  FileText,
  AlertTriangle,
  Building2,
  Users,
  Package,
  MapPin,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

interface NavItem {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
}

interface NavGroup {
  title: string
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  {
    title: 'Главная',
    items: [
      { label: 'Дашборд', href: '/', icon: LayoutDashboard },
    ],
  },
  {
    title: 'Проекты',
    items: [
      { label: 'Проекты', href: '/projects', icon: FolderKanban },
    ],
  },
  {
    title: 'Закупки',
    items: [
      { label: 'Тендеры', href: '/tenders', icon: Gavel },
      { label: 'Заказы поставщикам', href: '/purchase-orders', icon: ShoppingCart },
      { label: 'Поставки', href: '/deliveries', icon: Truck },
    ],
  },
  {
    title: 'Документы',
    items: [
      { label: 'Договоры', href: '/contracts', icon: FileText },
      { label: 'Претензии', href: '/claims', icon: AlertTriangle },
    ],
  },
  {
    title: 'Администрирование',
    items: [
      { label: 'Организации', href: '/admin/organizations', icon: Building2 },
      { label: 'Пользователи', href: '/admin/users', icon: Users },
      { label: 'Материалы', href: '/admin/materials', icon: Package },
      { label: 'Объекты', href: '/admin/sites', icon: MapPin },
    ],
  },
]

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()

  return (
    <aside
      className={cn(
        'flex h-screen flex-col border-r border-border bg-card transition-all duration-300',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center justify-between border-b border-border px-4">
        {!collapsed && (
          <span className="text-lg font-bold text-primary">EstiMat</span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent"
          aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-4">
        {navGroups.map((group) => (
          <div key={group.title} className="mb-4">
            {!collapsed && (
              <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group.title}
              </p>
            )}
            <ul className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon
                const isActive = item.href === '/'
                  ? pathname === '/'
                  : pathname.startsWith(item.href)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                      )}
                      title={collapsed ? item.label : undefined}
                    >
                      <Icon className="h-5 w-5 flex-shrink-0" />
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  )
}
