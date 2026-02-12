'use client'

import { useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, X, Loader2, Users } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { PageHeader } from '@/shared/components/page-header'
import {
  useProjectMembers,
  useAddProjectMember,
  MembersList,
} from '@/entities/project'
import { UserSelect } from '@/entities/user'

// ---------------------------------------------------------------------------
// Form schema
// ---------------------------------------------------------------------------

const MEMBER_ROLES = [
  'admin',
  'director',
  'project_manager',
  'engineer',
  'estimator',
  'procurement',
  'warehouse',
  'viewer',
  'rd_engineer',
  'procurement_manager',
  'contractor',
  'supplier',
  'finance',
] as const

const MEMBER_ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  director: 'Директор',
  project_manager: 'Руководитель проекта',
  engineer: 'Инженер',
  estimator: 'Сметчик',
  procurement: 'Снабженец',
  warehouse: 'Кладовщик',
  viewer: 'Наблюдатель',
  rd_engineer: 'Инженер ПД',
  procurement_manager: 'Менеджер закупок',
  contractor: 'Подрядчик',
  supplier: 'Поставщик',
  finance: 'Финансист',
}

const addMemberFormSchema = z.object({
  user_id: z.string().min(1, 'Выберите пользователя'),
  role: z.string().min(1, 'Выберите роль'),
})

type AddMemberFormValues = z.infer<typeof addMemberFormSchema>

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ProjectMembersWidgetProps {
  projectId: string
  projectName?: string
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export function ProjectMembersWidget({ projectId, projectName }: ProjectMembersWidgetProps) {
  const addMember = useAddProjectMember()
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <div>
      <PageHeader
        title="Участники проекта"
        breadcrumbs={[
          { label: 'Проекты', href: '/projects' },
          { label: projectName ?? 'Проект', href: `/projects/${projectId}` },
          { label: 'Участники' },
        ]}
        actions={
          <button
            onClick={() => setDialogOpen(true)}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Добавить участника
          </button>
        }
      />

      <div className="rounded-lg border border-border bg-card p-4">
        <MembersList
          projectId={projectId}
          canRemove
        />
      </div>

      {/* Add member dialog */}
      {dialogOpen && (
        <AddMemberDialog
          projectId={projectId}
          isPending={addMember.isPending}
          onClose={() => setDialogOpen(false)}
          onSubmit={(values) => {
            addMember.mutate(
              {
                project_id: projectId,
                user_id: values.user_id,
                role: values.role,
              },
              { onSuccess: () => setDialogOpen(false) }
            )
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// AddMemberDialog
// ---------------------------------------------------------------------------

function AddMemberDialog({
  projectId,
  isPending,
  onClose,
  onSubmit,
}: {
  projectId: string
  isPending: boolean
  onClose: () => void
  onSubmit: (values: AddMemberFormValues) => void
}) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<AddMemberFormValues>({
    resolver: zodResolver(addMemberFormSchema),
    defaultValues: {
      user_id: '',
      role: 'engineer',
    },
  })

  const selectedUserId = watch('user_id')

  const inputCn = cn(
    'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm',
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
    'placeholder:text-muted-foreground'
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Добавить участника</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Пользователь *</label>
            <UserSelect
              value={selectedUserId}
              onChange={(id) => setValue('user_id', id)}
            />
            {errors.user_id && (
              <p className="mt-1 text-xs text-destructive">{errors.user_id.message}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Роль в проекте *</label>
            <select {...register('role')} className={inputCn}>
              {MEMBER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {MEMBER_ROLE_LABELS[r] ?? r}
                </option>
              ))}
            </select>
            {errors.role && (
              <p className="mt-1 text-xs text-destructive">{errors.role.message}</p>
            )}
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
              Добавить
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
