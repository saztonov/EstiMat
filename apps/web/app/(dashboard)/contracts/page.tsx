'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, FileText, Loader2 } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { DataTable, PageHeader, type ColumnDef } from '@/shared/components'
import {
  useContractList,
  ContractStatusBadge,
  CONTRACT_STATUS_LABELS,
} from '@/entities/contract'
import type { ContractWithRelations, ContractStatus } from '@estimat/shared'
import { useDebounce } from '@/shared/hooks'

const CONTRACT_STATUSES: ContractStatus[] = ['draft', 'active', 'expired', 'terminated']

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '\u2014'
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatAmount(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '\u2014'
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount)
}

export default function ContractsPage() {
  const router = useRouter()
  const [statusFilter, setStatusFilter] = useState<ContractStatus | ''>('')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [showCreateDialog, setShowCreateDialog] = useState(false)

  const params = useMemo(
    () => ({
      status: statusFilter || undefined,
      search: debouncedSearch || undefined,
    }),
    [statusFilter, debouncedSearch]
  )

  const { contracts, total, isLoading, createContract, isMutating } =
    useContractList(params)

  const columns = useMemo<ColumnDef<ContractWithRelations, unknown>[]>(
    () => [
      {
        id: 'number',
        header: 'Номер',
        accessorFn: (row) => row.number ?? row.id.slice(0, 8).toUpperCase(),
        cell: ({ getValue }) => (
          <span className="font-medium text-foreground">
            {getValue() as string}
          </span>
        ),
        size: 150,
      },
      {
        id: 'name',
        header: 'Название',
        accessorKey: 'name',
        size: 260,
      },
      {
        id: 'counterparty',
        header: 'Контрагент',
        accessorFn: (row) =>
          (row as unknown as Record<string, unknown>).counterparty_name ??
          row.counterparty?.name ??
          '\u2014',
        size: 200,
      },
      {
        id: 'status',
        header: 'Статус',
        accessorKey: 'status',
        cell: ({ row }) => (
          <ContractStatusBadge status={row.original.status} />
        ),
        size: 140,
      },
      {
        id: 'amount',
        header: 'Сумма',
        accessorKey: 'total_amount',
        cell: ({ getValue }) => (
          <span className="tabular-nums text-right block">
            {formatAmount(getValue() as number | null)}
          </span>
        ),
        size: 150,
      },
      {
        id: 'start_date',
        header: 'Начало',
        accessorKey: 'start_date',
        cell: ({ getValue }) => formatDate(getValue() as string | null),
        size: 110,
      },
      {
        id: 'end_date',
        header: 'Окончание',
        accessorKey: 'end_date',
        cell: ({ getValue }) => formatDate(getValue() as string | null),
        size: 110,
      },
    ],
    []
  )

  const toolbar = (
    <div className="flex items-center gap-3">
      <select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value as ContractStatus | '')}
        className={cn(
          'h-9 rounded-md border border-input bg-transparent px-3 text-sm',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
        )}
      >
        <option value="">Все статусы</option>
        {CONTRACT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {CONTRACT_STATUS_LABELS[s]}
          </option>
        ))}
      </select>

      <button
        onClick={() => setShowCreateDialog(true)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors',
          'hover:bg-primary/90'
        )}
      >
        <Plus className="h-4 w-4" />
        Новый договор
      </button>
    </div>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Договоры"
        description={`Всего: ${total} договоров`}
        breadcrumbs={[
          { label: 'Главная', href: '/' },
          { label: 'Договоры' },
        ]}
      />

      <DataTable
        columns={columns}
        data={contracts}
        isLoading={isLoading}
        onSearch={setSearch}
        searchPlaceholder="Поиск договоров..."
        toolbar={toolbar}
      />

      {/* Create dialog placeholder */}
      {showCreateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setShowCreateDialog(false)}
          />
          <div className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-popover p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-foreground">
              Новый договор
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Форма создания договора (в разработке)
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowCreateDialog(false)}
                className={cn(
                  'inline-flex items-center rounded-md border border-input px-4 py-2 text-sm font-medium transition-colors',
                  'hover:bg-accent hover:text-accent-foreground'
                )}
              >
                Отмена
              </button>
              <button
                disabled
                className={cn(
                  'inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground',
                  'disabled:pointer-events-none disabled:opacity-50'
                )}
              >
                Создать
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
