'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { type ColumnDef, DataTable, PageHeader } from '@/shared/components'
import {
  useRequests,
  RequestStatusBadge,
  FundingTypeBadge,
  type PurchaseRequestWithRelations,
  type FundingType,
} from '@/entities/request'
import { cn } from '@/shared/lib/utils'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '\u2014'
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '\u2014'
  return new Date(dateString).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

const FUNDING_TABS: { label: string; value: FundingType | '' }[] = [
  { label: 'Все', value: '' },
  { label: 'Снабжение ГП', value: 'gp_supply' },
  { label: 'Распред. письмо', value: 'obs_letter' },
  { label: 'Авансирование', value: 'advance' },
]

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const columns: ColumnDef<PurchaseRequestWithRelations, unknown>[] = [
  {
    accessorKey: 'id',
    header: 'Номер',
    cell: ({ row }) => (
      <span className="font-medium text-foreground">
        Заявка #{row.original.id.slice(0, 8)}
      </span>
    ),
  },
  {
    accessorKey: 'funding_type',
    header: 'Тип',
    cell: ({ row }) => <FundingTypeBadge fundingType={row.original.funding_type} />,
  },
  {
    accessorKey: 'status',
    header: 'Статус',
    cell: ({ row }) => <RequestStatusBadge status={row.original.status} />,
  },
  {
    accessorKey: 'total',
    header: 'Сумма',
    cell: ({ row }) => (
      <span className="text-sm font-medium text-foreground text-right block">
        {formatCurrency(row.original.total)}
      </span>
    ),
  },
  {
    accessorKey: 'deadline',
    header: 'Дедлайн',
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {formatDate(row.original.deadline)}
      </span>
    ),
  },
]

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export function RequestListWidget() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const projectId = params.id

  const [fundingTab, setFundingTab] = useState<FundingType | ''>('')

  const queryParams = useMemo(
    () => ({
      funding_type: fundingTab || undefined,
    }),
    [fundingTab]
  )

  const { data, isLoading } = useRequests(projectId, queryParams)
  const requests = useMemo(() => data?.data ?? [], [data])

  const handleCreate = useCallback(() => {
    router.push(`/projects/${projectId}/requests/new`)
  }, [router, projectId])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Заявки на закупку"
        description="Управление заявками на материалы"
        breadcrumbs={[
          { label: 'Проекты', href: '/projects' },
          { label: 'Проект', href: `/projects/${projectId}` },
          { label: 'Заявки' },
        ]}
        actions={
          <button
            type="button"
            onClick={handleCreate}
            className={cn(
              'inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors',
              'hover:bg-primary/90'
            )}
          >
            <Plus className="h-4 w-4" />
            Создать заявку
          </button>
        }
      />

      {/* Funding type tabs */}
      <div className="flex items-center gap-1 rounded-lg border border-border p-1">
        {FUNDING_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setFundingTab(tab.value as FundingType | '')}
            className={cn(
              'inline-flex h-8 items-center rounded-md px-3 text-sm font-medium transition-colors',
              fundingTab === tab.value
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <DataTable<PurchaseRequestWithRelations>
        columns={columns}
        data={requests}
        isLoading={isLoading}
      />
    </div>
  )
}
