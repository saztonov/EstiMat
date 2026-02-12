'use client'

import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, AlertTriangle, FileText, Edit } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { PageHeader } from '@/shared/components'
import { useContractDetail, ContractStatusBadge, CONTRACT_STATUS_LABELS } from '@/entities/contract'

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

export default function ContractDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { contract, isLoading, isError, error } = useContractDetail(params.id)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Загрузка договора...</span>
      </div>
    )
  }

  if (isError || !contract) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive" />
        <p className="mt-3 text-sm text-destructive">
          {(error as Error)?.message ?? 'Договор не найден'}
        </p>
        <button
          onClick={() => router.push('/contracts')}
          className="mt-4 text-sm font-medium text-primary hover:underline"
        >
          Вернуться к списку
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title={contract.name ?? `Договор ${contract.number ?? contract.id.slice(0, 8).toUpperCase()}`}
        breadcrumbs={[
          { label: 'Главная', href: '/' },
          { label: 'Договоры', href: '/contracts' },
          { label: contract.number ?? contract.id.slice(0, 8).toUpperCase() },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/contracts"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm font-medium transition-colors',
                'hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <ArrowLeft className="h-4 w-4" />
              Назад
            </Link>
            <button
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors',
                'hover:bg-primary/90'
              )}
            >
              <Edit className="h-4 w-4" />
              Редактировать
            </button>
          </div>
        }
      />

      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold text-foreground">
          Информация о договоре
        </h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs font-medium uppercase text-muted-foreground">
              Номер
            </dt>
            <dd className="mt-1 text-sm font-medium text-foreground">
              {contract.number ?? '\u2014'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-muted-foreground">
              Статус
            </dt>
            <dd className="mt-1">
              <ContractStatusBadge status={contract.status} />
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-muted-foreground">
              Контрагент
            </dt>
            <dd className="mt-1 text-sm text-foreground">
              {((contract as unknown as Record<string, unknown>).counterparty_name as string) ??
                contract.counterparty?.name ??
                '\u2014'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-muted-foreground">
              Сумма
            </dt>
            <dd className="mt-1 text-sm font-medium text-foreground">
              {formatAmount(contract.total_amount)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-muted-foreground">
              Дата начала
            </dt>
            <dd className="mt-1 text-sm text-foreground">
              {formatDate(contract.start_date)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-muted-foreground">
              Дата окончания
            </dt>
            <dd className="mt-1 text-sm text-foreground">
              {formatDate(contract.end_date)}
            </dd>
          </div>
        </dl>
      </div>

      {contract.description && (
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            Описание
          </h2>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
            {contract.description}
          </p>
        </div>
      )}
    </div>
  )
}
