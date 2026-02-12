'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, LayoutGrid, List, X, Loader2, FolderKanban, Calendar, Building2 } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { PageHeader } from '@/shared/components/page-header'
import { DataTable, type ColumnDef } from '@/shared/components/data-table'
import { StatusBadge } from '@/shared/components/status-badge'
import {
  useProjects,
  useCreateProject,
  ProjectCard,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUSES,
  type ProjectWithOrg,
  type ProjectStatus,
} from '@/entities/project'
import { OrgSelect } from '@/entities/organization'
import { useDebounce } from '@/shared/hooks'

// ---------------------------------------------------------------------------
// Form schema
// ---------------------------------------------------------------------------

const projectFormSchema = z.object({
  name: z.string().min(1, 'Введите наименование проекта').max(255),
  org_id: z.string().min(1, 'Выберите организацию'),
  address: z.string().max(500).optional().nullable(),
  status: z.enum(PROJECT_STATUSES).optional().default('planning'),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
})

type ProjectFormValues = z.infer<typeof projectFormSchema>

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export function ProjectListWidget() {
  const router = useRouter()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [orgFilter, setOrgFilter] = useState<string>('')
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards')
  const debouncedSearch = useDebounce(search, 300)

  const params = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      status: statusFilter || undefined,
      org_id: orgFilter || undefined,
    }),
    [debouncedSearch, statusFilter, orgFilter]
  )

  const { data: projects = [], isLoading } = useProjects(params)
  const createProject = useCreateProject()

  const [dialogOpen, setDialogOpen] = useState(false)

  const navigateToProject = useCallback(
    (project: ProjectWithOrg) => {
      router.push(`/projects/${project.id}`)
    },
    [router]
  )

  // -------------------------------------------------------------------------
  // Columns (table view)
  // -------------------------------------------------------------------------

  const columns = useMemo<ColumnDef<ProjectWithOrg, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Наименование',
        cell: ({ row }) => (
          <button
            onClick={() => navigateToProject(row.original)}
            className="font-medium text-foreground hover:text-primary hover:underline text-left"
          >
            {row.original.name}
          </button>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Статус',
        cell: ({ row }) => (
          <StatusBadge status={PROJECT_STATUS_LABELS[row.original.status] ?? row.original.status} />
        ),
      },
      {
        id: 'organization',
        header: 'Организация',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.organization?.name ?? '\u2014'}
          </span>
        ),
      },
      {
        id: 'dates',
        header: 'Период',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatDate(row.original.start_date)} {'\u2014'} {formatDate(row.original.end_date)}
          </span>
        ),
      },
      {
        accessorKey: 'address',
        header: 'Адрес',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground truncate max-w-[200px] block">
            {row.original.address ?? '\u2014'}
          </span>
        ),
      },
    ],
    [navigateToProject]
  )

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div>
      <PageHeader
        title="Проекты"
        description="Управление строительными проектами"
        actions={
          <button
            onClick={() => setDialogOpen(true)}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Создать проект
          </button>
        }
      />

      {/* Filters and view toggle */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          {/* Search */}
          <div className="relative max-w-sm flex-1">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск проекта..."
              className={cn(
                'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 pl-9 text-sm shadow-sm transition-colors',
                'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
              )}
            />
            <FolderKanban className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">Все статусы</option>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>

          {/* Org filter */}
          <div className="w-56">
            <OrgSelect
              value={orgFilter}
              onChange={(id) => setOrgFilter(id)}
              placeholder="Организация"
            />
          </div>
        </div>

        {/* View toggle */}
        <div className="flex items-center rounded-md border border-input">
          <button
            onClick={() => setViewMode('cards')}
            className={cn(
              'inline-flex h-8 w-8 items-center justify-center rounded-l-md transition-colors',
              viewMode === 'cards'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted'
            )}
            aria-label="Карточки"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode('table')}
            className={cn(
              'inline-flex h-8 w-8 items-center justify-center rounded-r-md transition-colors',
              viewMode === 'table'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted'
            )}
            aria-label="Таблица"
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Загрузка проектов...</span>
        </div>
      ) : viewMode === 'cards' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.length > 0 ? (
            projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onClick={() => navigateToProject(project)}
              />
            ))
          ) : (
            <div className="col-span-full py-12 text-center text-sm text-muted-foreground">
              Проекты не найдены
            </div>
          )}
        </div>
      ) : (
        <DataTable columns={columns} data={projects} isLoading={isLoading} />
      )}

      {/* Create Project Dialog */}
      {dialogOpen && (
        <ProjectFormDialog
          isPending={createProject.isPending}
          onClose={() => setDialogOpen(false)}
          onSubmit={(values) => {
            createProject.mutate(
              {
                name: values.name,
                org_id: values.org_id,
                address: values.address ?? null,
                status: values.status,
                start_date: values.start_date ?? null,
                end_date: values.end_date ?? null,
              },
              {
                onSuccess: (data) => {
                  setDialogOpen(false)
                  router.push(`/projects/${data.id}`)
                },
              }
            )
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '\u2014'
  try {
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return dateStr
  }
}

// ---------------------------------------------------------------------------
// ProjectFormDialog
// ---------------------------------------------------------------------------

function ProjectFormDialog({
  isPending,
  onClose,
  onSubmit,
}: {
  isPending: boolean
  onClose: () => void
  onSubmit: (values: ProjectFormValues) => void
}) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: {
      name: '',
      org_id: '',
      address: '',
      status: 'planning',
      start_date: '',
      end_date: '',
    },
  })

  const selectedOrgId = watch('org_id')

  const inputCn = cn(
    'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm',
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
    'placeholder:text-muted-foreground'
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Новый проект</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Наименование *</label>
            <input {...register('name')} className={inputCn} placeholder="ЖК Астана Сити" />
            {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Организация *</label>
            <OrgSelect
              value={selectedOrgId}
              onChange={(id) => setValue('org_id', id)}
            />
            {errors.org_id && <p className="mt-1 text-xs text-destructive">{errors.org_id.message}</p>}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Адрес</label>
            <input {...register('address')} className={inputCn} placeholder="г. Астана, ул. Примерная, 1" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Дата начала</label>
              <input {...register('start_date')} type="date" className={inputCn} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Дата окончания</label>
              <input {...register('end_date')} type="date" className={inputCn} />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="h-9 rounded-md border border-input px-4 text-sm font-medium hover:bg-muted">
              Отмена
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Создать проект
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
