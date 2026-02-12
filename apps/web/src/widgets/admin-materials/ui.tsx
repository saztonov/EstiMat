'use client'

import { useState, useMemo, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Pencil, Trash2, X, Loader2, FolderPlus, Search } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { PageHeader } from '@/shared/components/page-header'
import { DataTable, type ColumnDef } from '@/shared/components/data-table'
import {
  useMaterials,
  useMaterialGroups,
  useCreateMaterial,
  useUpdateMaterial,
  useDeleteMaterial,
  useCreateMaterialGroup,
  useUpdateMaterialGroup,
  useDeleteMaterialGroup,
  MaterialGroupTree,
  type MaterialCatalogWithGroup,
  type MaterialGroup,
} from '@/entities/material'
import { useDebounce } from '@/shared/hooks'

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const materialFormSchema = z.object({
  name: z.string().min(1, 'Введите наименование материала').max(255),
  group_id: z.string().optional().nullable(),
  unit: z.string().min(1, 'Введите единицу измерения').max(50),
  description: z.string().max(1000).optional().nullable(),
})

type MaterialFormValues = z.infer<typeof materialFormSchema>

const groupFormSchema = z.object({
  name: z.string().min(1, 'Введите наименование группы').max(255),
  code: z.string().max(50).optional().nullable(),
  parent_id: z.string().optional().nullable(),
})

type GroupFormValues = z.infer<typeof groupFormSchema>

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export function AdminMaterialsWidget() {
  const [search, setSearch] = useState('')
  const [selectedGroupId, setSelectedGroupId] = useState<string | undefined>(undefined)
  const debouncedSearch = useDebounce(search, 300)

  const params = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      group_id: selectedGroupId || undefined,
    }),
    [debouncedSearch, selectedGroupId]
  )

  const { data: materials = [], isLoading } = useMaterials(params)
  const { data: groups = [] } = useMaterialGroups()

  const createMaterial = useCreateMaterial()
  const updateMaterial = useUpdateMaterial()
  const deleteMaterial = useDeleteMaterial()
  const createGroup = useCreateMaterialGroup()
  const updateGroup = useUpdateMaterialGroup()
  const deleteGroup = useDeleteMaterialGroup()

  const [materialDialogOpen, setMaterialDialogOpen] = useState(false)
  const [editingMaterial, setEditingMaterial] = useState<MaterialCatalogWithGroup | null>(null)
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<MaterialGroup | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deleteGroupConfirmId, setDeleteGroupConfirmId] = useState<string | null>(null)

  const handleSelectGroup = useCallback((group: MaterialGroup) => {
    setSelectedGroupId(group.id || undefined)
  }, [])

  const openCreateMaterial = useCallback(() => {
    setEditingMaterial(null)
    setMaterialDialogOpen(true)
  }, [])

  const openEditMaterial = useCallback((m: MaterialCatalogWithGroup) => {
    setEditingMaterial(m)
    setMaterialDialogOpen(true)
  }, [])

  const openCreateGroup = useCallback(() => {
    setEditingGroup(null)
    setGroupDialogOpen(true)
  }, [])

  const openEditGroup = useCallback(() => {
    if (!selectedGroupId) return
    const g = groups.find((grp) => grp.id === selectedGroupId)
    if (g) {
      setEditingGroup(g)
      setGroupDialogOpen(true)
    }
  }, [selectedGroupId, groups])

  // -------------------------------------------------------------------------
  // Columns
  // -------------------------------------------------------------------------

  const columns = useMemo<ColumnDef<MaterialCatalogWithGroup, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Наименование',
        cell: ({ row }) => (
          <span className="font-medium text-foreground">{row.original.name}</span>
        ),
      },
      {
        id: 'code',
        header: 'Код',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.group?.code ?? '\u2014'}
          </span>
        ),
      },
      {
        accessorKey: 'unit',
        header: 'Единица',
        size: 100,
        cell: ({ row }) => (
          <span className="text-sm">{row.original.unit}</span>
        ),
      },
      {
        id: 'group',
        header: 'Группа',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.group?.name ?? '\u2014'}
          </span>
        ),
      },
      {
        accessorKey: 'description',
        header: 'Описание',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground truncate max-w-[200px] block">
            {row.original.description ?? '\u2014'}
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
              onClick={() => openEditMaterial(row.original)}
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
    [openEditMaterial]
  )

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div>
      <PageHeader
        title="Справочник материалов"
        description="Управление группами и материалами"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={openCreateGroup}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-input px-4 text-sm font-medium hover:bg-muted"
            >
              <FolderPlus className="h-4 w-4" />
              Группа
            </button>
            <button
              onClick={openCreateMaterial}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              Материал
            </button>
          </div>
        }
      />

      <div className="flex gap-6">
        {/* Left panel: group tree */}
        <div className="w-64 shrink-0">
          <div className="rounded-md border border-border bg-card p-3">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Группы</h3>
              {selectedGroupId && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={openEditGroup}
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                    aria-label="Редактировать группу"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => setDeleteGroupConfirmId(selectedGroupId)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30"
                    aria-label="Удалить группу"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
            <MaterialGroupTree
              selectedId={selectedGroupId}
              onSelect={handleSelectGroup}
            />
          </div>
        </div>

        {/* Right panel: materials table */}
        <div className="min-w-0 flex-1">
          <DataTable
            columns={columns}
            data={materials}
            isLoading={isLoading}
            onSearch={setSearch}
            searchPlaceholder="Поиск по названию материала..."
          />
        </div>
      </div>

      {/* Material Form Dialog */}
      {materialDialogOpen && (
        <MaterialFormDialog
          material={editingMaterial}
          groups={groups}
          selectedGroupId={selectedGroupId}
          isPending={createMaterial.isPending || updateMaterial.isPending}
          onClose={() => setMaterialDialogOpen(false)}
          onSubmit={(values) => {
            const payload = {
              name: values.name,
              group_id: values.group_id || null,
              unit: values.unit,
              description: values.description ?? null,
              is_active: true,
              attributes: {},
            }

            if (editingMaterial) {
              updateMaterial.mutate(
                { id: editingMaterial.id, data: payload },
                { onSuccess: () => setMaterialDialogOpen(false) }
              )
            } else {
              createMaterial.mutate(payload, {
                onSuccess: () => setMaterialDialogOpen(false),
              })
            }
          }}
        />
      )}

      {/* Group Form Dialog */}
      {groupDialogOpen && (
        <GroupFormDialog
          group={editingGroup}
          groups={groups}
          isPending={createGroup.isPending || updateGroup.isPending}
          onClose={() => setGroupDialogOpen(false)}
          onSubmit={(values) => {
            const payload = {
              name: values.name,
              code: values.code ?? null,
              parent_id: values.parent_id || null,
            }

            if (editingGroup) {
              updateGroup.mutate(
                { id: editingGroup.id, data: payload },
                { onSuccess: () => setGroupDialogOpen(false) }
              )
            } else {
              createGroup.mutate(payload, {
                onSuccess: () => setGroupDialogOpen(false),
              })
            }
          }}
        />
      )}

      {/* Delete Material Confirmation */}
      {deleteConfirmId && (
        <ConfirmDialog
          title="Удалить материал?"
          message="Это действие необратимо. Материал будет удален из справочника."
          isPending={deleteMaterial.isPending}
          onClose={() => setDeleteConfirmId(null)}
          onConfirm={() => {
            deleteMaterial.mutate(deleteConfirmId, {
              onSuccess: () => setDeleteConfirmId(null),
            })
          }}
        />
      )}

      {/* Delete Group Confirmation */}
      {deleteGroupConfirmId && (
        <ConfirmDialog
          title="Удалить группу материалов?"
          message="Группа будет удалена. Материалы этой группы станут без группы."
          isPending={deleteGroup.isPending}
          onClose={() => setDeleteGroupConfirmId(null)}
          onConfirm={() => {
            deleteGroup.mutate(deleteGroupConfirmId, {
              onSuccess: () => {
                setDeleteGroupConfirmId(null)
                if (selectedGroupId === deleteGroupConfirmId) {
                  setSelectedGroupId(undefined)
                }
              },
            })
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// MaterialFormDialog
// ---------------------------------------------------------------------------

function MaterialFormDialog({
  material,
  groups,
  selectedGroupId,
  isPending,
  onClose,
  onSubmit,
}: {
  material: MaterialCatalogWithGroup | null
  groups: MaterialGroup[]
  selectedGroupId?: string
  isPending: boolean
  onClose: () => void
  onSubmit: (values: MaterialFormValues) => void
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<MaterialFormValues>({
    resolver: zodResolver(materialFormSchema),
    defaultValues: material
      ? {
          name: material.name,
          group_id: material.group_id ?? '',
          unit: material.unit,
          description: material.description ?? '',
        }
      : {
          name: '',
          group_id: selectedGroupId ?? '',
          unit: '',
          description: '',
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
            {material ? 'Редактировать материал' : 'Новый материал'}
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Наименование *</label>
            <input {...register('name')} className={inputCn} placeholder="Арматура А500С d12" />
            {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Группа</label>
            <select {...register('group_id')} className={inputCn}>
              <option value="">Без группы</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.code ? `[${g.code}] ` : ''}{g.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Единица измерения *</label>
            <input {...register('unit')} className={inputCn} placeholder="т, м3, шт, м.п." />
            {errors.unit && <p className="mt-1 text-xs text-destructive">{errors.unit.message}</p>}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Описание</label>
            <textarea {...register('description')} className={cn(inputCn, 'min-h-[80px]')} placeholder="Описание материала..." />
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
              {material ? 'Сохранить' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// GroupFormDialog
// ---------------------------------------------------------------------------

function GroupFormDialog({
  group,
  groups,
  isPending,
  onClose,
  onSubmit,
}: {
  group: MaterialGroup | null
  groups: MaterialGroup[]
  isPending: boolean
  onClose: () => void
  onSubmit: (values: GroupFormValues) => void
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<GroupFormValues>({
    resolver: zodResolver(groupFormSchema),
    defaultValues: group
      ? { name: group.name, code: group.code ?? '', parent_id: group.parent_id ?? '' }
      : { name: '', code: '', parent_id: '' },
  })

  const inputCn = cn(
    'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm',
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
    'placeholder:text-muted-foreground'
  )

  // Exclude current group from parent options to prevent circular references
  const parentOptions = groups.filter((g) => !group || g.id !== group.id)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            {group ? 'Редактировать группу' : 'Новая группа материалов'}
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Наименование *</label>
            <input {...register('name')} className={inputCn} placeholder="Арматура" />
            {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Код</label>
            <input {...register('code')} className={inputCn} placeholder="MAT-001" />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Родительская группа</label>
            <select {...register('parent_id')} className={inputCn}>
              <option value="">Нет (корневая группа)</option>
              {parentOptions.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.code ? `[${g.code}] ` : ''}{g.name}
                </option>
              ))}
            </select>
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
              {group ? 'Сохранить' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ConfirmDialog
// ---------------------------------------------------------------------------

function ConfirmDialog({
  title,
  message,
  isPending,
  onClose,
  onConfirm,
}: {
  title: string
  message: string
  isPending: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <div className="mt-4 flex justify-end gap-3">
          <button onClick={onClose} className="h-9 rounded-md border border-input px-4 text-sm font-medium hover:bg-muted">
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
