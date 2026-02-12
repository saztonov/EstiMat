'use client'

import { useState, useMemo, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Pencil, Trash2, X, Loader2, Search } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { PageHeader } from '@/shared/components/page-header'
import { DataTable, type ColumnDef } from '@/shared/components/data-table'
import {
  useOrganizations,
  useCreateOrganization,
  useUpdateOrganization,
  useDeleteOrganization,
  OrgBadge,
  ORG_TYPE_LABELS,
  ORG_TYPES,
  type Organization,
  type OrganizationWithStats,
  type OrgType,
  type CreateOrganizationInput,
} from '@/entities/organization'
import { useDebounce } from '@/shared/hooks'

// ---------------------------------------------------------------------------
// Form schema (overriding shared schema with Russian validation messages)
// ---------------------------------------------------------------------------

const orgFormSchema = z.object({
  name: z.string().min(1, 'Введите наименование организации').max(255),
  short_name: z.string().max(100).optional(),
  type: z.enum(ORG_TYPES, { required_error: 'Выберите тип организации' }),
  inn: z.string().max(12, 'ИНН не более 12 символов').optional().nullable(),
  kpp: z.string().max(9, 'КПП не более 9 символов').optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  email: z.string().email('Введите корректный email').or(z.literal('')).optional().nullable(),
})

type OrgFormValues = z.infer<typeof orgFormSchema>

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export function AdminOrganizationsWidget() {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const debouncedSearch = useDebounce(search, 300)

  const params = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      type: typeFilter || undefined,
    }),
    [debouncedSearch, typeFilter]
  )

  const { data: organizations = [], isLoading } = useOrganizations(params)
  const createOrg = useCreateOrganization()
  const updateOrg = useUpdateOrganization()
  const deleteOrg = useDeleteOrganization()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingOrg, setEditingOrg] = useState<OrganizationWithStats | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const openCreate = useCallback(() => {
    setEditingOrg(null)
    setDialogOpen(true)
  }, [])

  const openEdit = useCallback((org: OrganizationWithStats) => {
    setEditingOrg(org)
    setDialogOpen(true)
  }, [])

  const handleDelete = useCallback(
    (id: string) => {
      deleteOrg.mutate(id, {
        onSuccess: () => setDeleteConfirmId(null),
      })
    },
    [deleteOrg]
  )

  // -------------------------------------------------------------------------
  // Columns
  // -------------------------------------------------------------------------

  const columns = useMemo<ColumnDef<OrganizationWithStats, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Наименование',
        cell: ({ row }) => (
          <span className="font-medium text-foreground">{row.original.name}</span>
        ),
      },
      {
        accessorKey: 'type',
        header: 'Тип',
        cell: ({ row }) => <OrgBadge type={row.original.type} />,
      },
      {
        accessorKey: 'inn',
        header: 'ИНН',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.inn ?? '\u2014'}
          </span>
        ),
      },
      {
        id: 'phone',
        header: 'Телефон',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.contacts?.phone ?? '\u2014'}
          </span>
        ),
      },
      {
        id: 'email',
        header: 'Email',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.contacts?.email ?? '\u2014'}
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
        title="Организации"
        description="Управление организациями в системе"
        actions={
          <button
            onClick={openCreate}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Добавить организацию
          </button>
        }
      />

      <DataTable
        columns={columns}
        data={organizations}
        isLoading={isLoading}
        onSearch={setSearch}
        searchPlaceholder="Поиск по названию или ИНН..."
        toolbar={
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">Все типы</option>
            {ORG_TYPES.map((t) => (
              <option key={t} value={t}>
                {ORG_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        }
      />

      {/* Create / Edit Dialog */}
      {dialogOpen && (
        <OrgFormDialog
          org={editingOrg}
          isPending={createOrg.isPending || updateOrg.isPending}
          onClose={() => setDialogOpen(false)}
          onSubmit={(values) => {
            const payload: CreateOrganizationInput = {
              name: values.name,
              type: values.type,
              is_active: true,
              inn: values.inn ?? null,
              address: values.address ?? null,
              contacts: {
                ...(values.phone ? { phone: values.phone } : {}),
                ...(values.email ? { email: values.email } : {}),
                ...(values.short_name ? { short_name: values.short_name } : {}),
                ...(values.kpp ? { kpp: values.kpp } : {}),
              },
            }

            if (editingOrg) {
              updateOrg.mutate(
                { id: editingOrg.id, data: payload },
                { onSuccess: () => setDialogOpen(false) }
              )
            } else {
              createOrg.mutate(payload, {
                onSuccess: () => setDialogOpen(false),
              })
            }
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirmId && (
        <ConfirmDeleteDialog
          isPending={deleteOrg.isPending}
          onClose={() => setDeleteConfirmId(null)}
          onConfirm={() => handleDelete(deleteConfirmId)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// OrgFormDialog
// ---------------------------------------------------------------------------

function OrgFormDialog({
  org,
  isPending,
  onClose,
  onSubmit,
}: {
  org: OrganizationWithStats | null
  isPending: boolean
  onClose: () => void
  onSubmit: (values: OrgFormValues) => void
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<OrgFormValues>({
    resolver: zodResolver(orgFormSchema),
    defaultValues: org
      ? {
          name: org.name,
          short_name: org.contacts?.short_name ?? '',
          type: org.type,
          inn: org.inn ?? '',
          kpp: org.contacts?.kpp ?? '',
          address: org.address ?? '',
          phone: org.contacts?.phone ?? '',
          email: org.contacts?.email ?? '',
        }
      : {
          name: '',
          type: 'client' as OrgType,
          inn: '',
          kpp: '',
          address: '',
          phone: '',
          email: '',
        },
  })

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
            {org ? 'Редактировать организацию' : 'Новая организация'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* name */}
          <div>
            <label className="mb-1 block text-sm font-medium">Наименование *</label>
            <input {...register('name')} className={inputCn} placeholder="ООО Стройком" />
            {errors.name && (
              <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>

          {/* short_name */}
          <div>
            <label className="mb-1 block text-sm font-medium">Краткое наименование</label>
            <input {...register('short_name')} className={inputCn} placeholder="Стройком" />
          </div>

          {/* type */}
          <div>
            <label className="mb-1 block text-sm font-medium">Тип организации *</label>
            <select {...register('type')} className={inputCn}>
              {ORG_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ORG_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            {errors.type && (
              <p className="mt-1 text-xs text-destructive">{errors.type.message}</p>
            )}
          </div>

          {/* inn + kpp */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">ИНН</label>
              <input {...register('inn')} className={inputCn} placeholder="1234567890" />
              {errors.inn && (
                <p className="mt-1 text-xs text-destructive">{errors.inn.message}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">КПП</label>
              <input {...register('kpp')} className={inputCn} placeholder="123456789" />
              {errors.kpp && (
                <p className="mt-1 text-xs text-destructive">{errors.kpp.message}</p>
              )}
            </div>
          </div>

          {/* address */}
          <div>
            <label className="mb-1 block text-sm font-medium">Адрес</label>
            <input {...register('address')} className={inputCn} placeholder="г. Астана, ул. Примерная, 1" />
          </div>

          {/* phone + email */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Телефон</label>
              <input {...register('phone')} className={inputCn} placeholder="+7 (777) 123-45-67" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Email</label>
              <input {...register('email')} type="email" className={inputCn} placeholder="info@company.kz" />
              {errors.email && (
                <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-md border border-input px-4 text-sm font-medium hover:bg-muted"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {org ? 'Сохранить' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ConfirmDeleteDialog
// ---------------------------------------------------------------------------

function ConfirmDeleteDialog({
  isPending,
  onClose,
  onConfirm,
}: {
  isPending: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
        <h3 className="text-lg font-semibold text-foreground">Удалить организацию?</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Это действие необратимо. Организация и все связанные данные будут удалены.
        </p>
        <div className="mt-4 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="h-9 rounded-md border border-input px-4 text-sm font-medium hover:bg-muted"
          >
            Отмена
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Удалить
          </button>
        </div>
      </div>
    </div>
  )
}
