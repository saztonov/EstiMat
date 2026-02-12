'use client'

import { useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { DataTable, PageHeader, type ColumnDef } from '@/shared/components'
import { useBoqs, BoqStatusBadge } from '@/entities/boq'
import type { BoqWithRelations } from '@/entities/boq'

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '\u2014'
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export default function BoqListPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const projectId = params.id

  const { data, isLoading } = useBoqs({ project_id: projectId } as never)
  const boqs: BoqWithRelations[] = (data as unknown as { data?: BoqWithRelations[] })?.data ?? (Array.isArray(data) ? data : [])

  const columns = useMemo<ColumnDef<BoqWithRelations, unknown>[]>(
    () => [
      {
        id: 'name',
        header: 'Название',
        accessorKey: 'name',
        cell: ({ getValue }) => (
          <span className="font-medium text-foreground">
            {(getValue() as string) || '\u2014'}
          </span>
        ),
        size: 280,
      },
      {
        id: 'status',
        header: 'Статус',
        accessorKey: 'status',
        cell: ({ row }) => <BoqStatusBadge status={row.original.status} />,
        size: 140,
      },
      {
        id: 'items_count',
        header: 'Позиций',
        accessorFn: (row) => row.items_count ?? 0,
        size: 100,
      },
      {
        id: 'created_at',
        header: 'Создан',
        accessorKey: 'created_at',
        cell: ({ getValue }) => formatDate(getValue() as string | null),
        size: 120,
      },
    ],
    []
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ведомости объёмов работ (BOQ)"
        breadcrumbs={[
          { label: 'Проекты', href: '/projects' },
          { label: 'Проект', href: `/projects/${projectId}` },
          { label: 'BOQ' },
        ]}
        actions={
          <Link
            href={`/projects/${projectId}/boq/new`}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors',
              'hover:bg-primary/90'
            )}
          >
            <Plus className="h-4 w-4" />
            Создать BOQ
          </Link>
        }
      />

      <DataTable
        columns={columns}
        data={boqs}
        isLoading={isLoading}
      />
    </div>
  )
}
