'use client'

import { useState, useMemo, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Pencil, Trash2, X, Loader2, MapPin } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { PageHeader } from '@/shared/components/page-header'
import { DataTable, type ColumnDef } from '@/shared/components/data-table'
import { useProjects, ProjectSelect, type Site } from '@/entities/project'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// ---------------------------------------------------------------------------
// API hooks for sites
// ---------------------------------------------------------------------------

const siteKeys = {
  all: ['sites'] as const,
  list: (params?: { project_id?: string }) => [...siteKeys.all, 'list', params] as const,
}

interface SiteWithProject extends Site {
  project?: { id: string; name: string } | null
}

function useSites(params?: { project_id?: string }) {
  return useQuery<SiteWithProject[]>({
    queryKey: siteKeys.list(params),
    queryFn: async () => {
      const searchParams = new URLSearchParams()
      if (params?.project_id) searchParams.set('project_id', params.project_id)
      const res = await fetch(`/api/v1/sites?${searchParams}`)
      if (!res.ok) throw new Error('Не удалось загрузить площадки')
      const json = await res.json()
      return json.data ?? json
    },
  })
}

function useCreateSite() {
  const queryClient = useQueryClient()
  return useMutation<Site, Error, { project_id: string; name: string; code?: string; address?: string | null }>({
    mutationFn: async (data) => {
      const res = await fetch('/api/v1/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error?.error?.message ?? 'Не удалось создать площадку')
      }
      const json = await res.json()
      return json.data ?? json
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteKeys.all })
    },
  })
}

function useUpdateSite() {
  const queryClient = useQueryClient()
  return useMutation<Site, Error, { id: string; data: { name?: string; code?: string; address?: string | null } }>({
    mutationFn: async ({ id, data }) => {
      const res = await fetch(`/api/v1/sites/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error?.error?.message ?? 'Не удалось обновить площадку')
      }
      const json = await res.json()
      return json.data ?? json
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteKeys.all })
    },
  })
}

function useDeleteSite() {
  const queryClient = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const res = await fetch(`/api/v1/sites/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error?.error?.message ?? 'Не удалось удалить площадку')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteKeys.all })
    },
  })
}

// ---------------------------------------------------------------------------
// Form schema
// ---------------------------------------------------------------------------

const siteFormSchema = z.object({
  name: z.string().min(1, 'Введите наименование площадки').max(255),
  code: z.string().max(50).optional(),
  project_id: z.string().min(1, 'Выберите проект'),
  address: z.string().max(500).optional().nullable(),
})

type SiteFormValues = z.infer<typeof siteFormSchema>

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export function AdminSitesWidget() {
  const [projectFilter, setProjectFilter] = useState<string>('')

  const params = useMemo(
    () => ({
      project_id: projectFilter || undefined,
    }),
    [projectFilter]
  )

  const { data: sites = [], isLoading } = useSites(params)
  const createSite = useCreateSite()
  const updateSite = useUpdateSite()
  const deleteSite = useDeleteSite()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSite, setEditingSite] = useState<SiteWithProject | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const openCreate = useCallback(() => {
    setEditingSite(null)
    setDialogOpen(true)
  }, [])

  const openEdit = useCallback((site: SiteWithProject) => {
    setEditingSite(site)
    setDialogOpen(true)
  }, [])

  // -------------------------------------------------------------------------
  // Columns
  // -------------------------------------------------------------------------

  const columns = useMemo<ColumnDef<SiteWithProject, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Наименование',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="font-medium text-foreground">{row.original.name}</span>
          </div>
        ),
      },
      {
        id: 'code',
        header: 'Код',
        size: 120,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {(row.original as unknown as Record<string, string>).code ?? '\u2014'}
          </span>
        ),
      },
      {
        id: 'project',
        header: 'Проект',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.project?.name ?? '\u2014'}
          </span>
        ),
      },
      {
        accessorKey: 'address',
        header: 'Адрес',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground truncate max-w-[300px] block">
            {row.original.address ?? '\u2014'}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        size: 80,
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <button
              onClick={() => openEdit(row.original)}
              className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Редактировать"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setDeleteConfirmId(row.original.id)}
              className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30"
              aria-label="Удалить"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ),
      },
    ],
    [openEdit]
  )

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div>
      <PageHeader
        title="Площадки"
        description="Управление строительными площадками"
        actions={
          <button
            onClick={openCreate}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Добавить площадку
          </button>
        }
      />

      <DataTable
        columns={columns}
        data={sites}
        isLoading={isLoading}
        toolbar={
          <div className="w-64">
            <ProjectSelect
              value={projectFilter}
              onChange={(id) => setProjectFilter(id)}
              placeholder="Фильтр по проекту"
            />
          </div>
        }
      />

      {/* Create / Edit Dialog */}
      {dialogOpen && (
        <SiteFormDialog
          site={editingSite}
          defaultProjectId={projectFilter}
          isPending={createSite.isPending || updateSite.isPending}
          onClose={() => setDialogOpen(false)}
          onSubmit={(values) => {
            if (editingSite) {
              updateSite.mutate(
                {
                  id: editingSite.id,
                  data: {
                    name: values.name,
                    code: values.code,
                    address: values.address ?? null,
                  },
                },
                { onSuccess: () => setDialogOpen(false) }
              )
            } else {
              createSite.mutate(
                {
                  project_id: values.project_id,
                  name: values.name,
                  code: values.code,
                  address: values.address ?? null,
                },
                { onSuccess: () => setDialogOpen(false) }
              )
            }
          }}
        />
      )}

      {/* Delete Confirmation */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
            <h3 className="text-lg font-semibold text-foreground">Удалить площадку?</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Это действие необратимо. Площадка будет удалена.
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="h-9 rounded-md border border-input px-4 text-sm font-medium hover:bg-muted"
              >
                Отмена
              </button>
              <button
                onClick={() => {
                  deleteSite.mutate(deleteConfirmId, {
                    onSuccess: () => setDeleteConfirmId(null),
                  })
                }}
                disabled={deleteSite.isPending}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
              >
                {deleteSite.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SiteFormDialog
// ---------------------------------------------------------------------------

function SiteFormDialog({
  site,
  defaultProjectId,
  isPending,
  onClose,
  onSubmit,
}: {
  site: SiteWithProject | null
  defaultProjectId?: string
  isPending: boolean
  onClose: () => void
  onSubmit: (values: SiteFormValues) => void
}) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<SiteFormValues>({
    resolver: zodResolver(siteFormSchema),
    defaultValues: site
      ? {
          name: site.name,
          code: (site as unknown as Record<string, string>).code ?? '',
          project_id: site.project_id,
          address: site.address ?? '',
        }
      : {
          name: '',
          code: '',
          project_id: defaultProjectId ?? '',
          address: '',
        },
  })

  const selectedProjectId = watch('project_id')

  const inputCn = cn(
    'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm',
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
    'placeholder:text-muted-foreground'
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            {site ? 'Редактировать площадку' : 'Новая площадка'}
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Наименование *</label>
            <input {...register('name')} className={inputCn} placeholder="Площадка A" />
            {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Код</label>
            <input {...register('code')} className={inputCn} placeholder="SITE-001" />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Проект *</label>
            <ProjectSelect
              value={selectedProjectId}
              onChange={(id) => setValue('project_id', id)}
              disabled={!!site}
            />
            {errors.project_id && (
              <p className="mt-1 text-xs text-destructive">{errors.project_id.message}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Адрес</label>
            <input {...register('address')} className={inputCn} placeholder="г. Астана, район строительства" />
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
              {site ? 'Сохранить' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
