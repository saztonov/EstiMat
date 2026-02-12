'use client'

import { useState, useMemo, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Pencil, X, Loader2 } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { PageHeader } from '@/shared/components/page-header'
import { DataTable, type ColumnDef } from '@/shared/components/data-table'
import {
  useUsers,
  useCreateUser,
  useUpdateUser,
  UserAvatar,
  RoleBadge,
  ROLE_LABELS,
  USER_ROLES,
  type UserWithOrg,
  type UserRole,
} from '@/entities/user'
import { OrgSelect } from '@/entities/organization'
import { useDebounce } from '@/shared/hooks'

// ---------------------------------------------------------------------------
// Form schema
// ---------------------------------------------------------------------------

const userFormSchema = z.object({
  full_name: z.string().min(1, 'Введите ФИО').max(255),
  email: z.string().email('Введите корректный email'),
  role: z.enum(USER_ROLES, { required_error: 'Выберите роль' }),
  org_id: z.string().optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
})

type UserFormValues = z.infer<typeof userFormSchema>

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export function AdminUsersWidget() {
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('')
  const debouncedSearch = useDebounce(search, 300)

  const params = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      role: roleFilter || undefined,
    }),
    [debouncedSearch, roleFilter]
  )

  const { data: users = [], isLoading } = useUsers(params)
  const createUser = useCreateUser()
  const updateUser = useUpdateUser()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<UserWithOrg | null>(null)

  const openCreate = useCallback(() => {
    setEditingUser(null)
    setDialogOpen(true)
  }, [])

  const openEdit = useCallback((user: UserWithOrg) => {
    setEditingUser(user)
    setDialogOpen(true)
  }, [])

  // -------------------------------------------------------------------------
  // Columns
  // -------------------------------------------------------------------------

  const columns = useMemo<ColumnDef<UserWithOrg, unknown>[]>(
    () => [
      {
        accessorKey: 'full_name',
        header: 'Пользователь',
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <UserAvatar fullName={row.original.full_name} size="sm" />
            <span className="font-medium text-foreground">{row.original.full_name}</span>
          </div>
        ),
      },
      {
        accessorKey: 'email',
        header: 'Email',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{row.original.email}</span>
        ),
      },
      {
        accessorKey: 'role',
        header: 'Роль',
        cell: ({ row }) => <RoleBadge role={row.original.role} />,
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
        id: 'status',
        header: 'Статус',
        size: 100,
        cell: ({ row }) => (
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
              row.original.is_active
                ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400'
                : 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-400'
            )}
          >
            {row.original.is_active ? 'Активен' : 'Неактивен'}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        size: 50,
        cell: ({ row }) => (
          <button
            onClick={() => openEdit(row.original)}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Редактировать"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
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
        title="Пользователи"
        description="Управление пользователями системы"
        actions={
          <button
            onClick={openCreate}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Добавить пользователя
          </button>
        }
      />

      <DataTable
        columns={columns}
        data={users}
        isLoading={isLoading}
        onSearch={setSearch}
        searchPlaceholder="Поиск по имени или email..."
        toolbar={
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">Все роли</option>
            {USER_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        }
      />

      {/* Create / Edit Dialog */}
      {dialogOpen && (
        <UserFormDialog
          user={editingUser}
          isPending={createUser.isPending || updateUser.isPending}
          onClose={() => setDialogOpen(false)}
          onSubmit={(values) => {
            const payload = {
              full_name: values.full_name,
              email: values.email,
              role: values.role,
              org_id: values.org_id || null,
              phone: values.phone || null,
              is_active: true,
            }

            if (editingUser) {
              updateUser.mutate(
                { id: editingUser.id, data: payload },
                { onSuccess: () => setDialogOpen(false) }
              )
            } else {
              createUser.mutate(payload, {
                onSuccess: () => setDialogOpen(false),
              })
            }
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// UserFormDialog
// ---------------------------------------------------------------------------

function UserFormDialog({
  user,
  isPending,
  onClose,
  onSubmit,
}: {
  user: UserWithOrg | null
  isPending: boolean
  onClose: () => void
  onSubmit: (values: UserFormValues) => void
}) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<UserFormValues>({
    resolver: zodResolver(userFormSchema),
    defaultValues: user
      ? {
          full_name: user.full_name,
          email: user.email,
          role: user.role,
          org_id: user.org_id ?? '',
          phone: user.phone ?? '',
        }
      : {
          full_name: '',
          email: '',
          role: 'rd_engineer' as UserRole,
          org_id: '',
          phone: '',
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
          <h2 className="text-lg font-semibold text-foreground">
            {user ? 'Редактировать пользователя' : 'Новый пользователь'}
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">ФИО *</label>
            <input {...register('full_name')} className={inputCn} placeholder="Иванов Иван Иванович" />
            {errors.full_name && (
              <p className="mt-1 text-xs text-destructive">{errors.full_name.message}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Email *</label>
            <input {...register('email')} type="email" className={inputCn} placeholder="user@company.kz" />
            {errors.email && (
              <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Роль *</label>
            <select {...register('role')} className={inputCn}>
              {USER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            {errors.role && (
              <p className="mt-1 text-xs text-destructive">{errors.role.message}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Организация</label>
            <OrgSelect
              value={selectedOrgId ?? ''}
              onChange={(id) => setValue('org_id', id || null)}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Телефон</label>
            <input {...register('phone')} className={inputCn} placeholder="+7 (777) 123-45-67" />
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
              {user ? 'Сохранить' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
