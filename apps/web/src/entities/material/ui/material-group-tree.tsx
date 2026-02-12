'use client'

import { useState, useMemo, useCallback } from 'react'
import { ChevronRight, Folder, FolderOpen, Loader2 } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { useMaterialGroups } from '../api/queries'
import type { MaterialGroup } from '../types'

// ============================================================================
// Tree node type: flat MaterialGroup[] -> nested tree
// ============================================================================

interface TreeNode {
  group: MaterialGroup
  children: TreeNode[]
}

function buildTree(groups: MaterialGroup[]): TreeNode[] {
  const map = new Map<string, TreeNode>()
  const roots: TreeNode[] = []

  // Create nodes
  for (const group of groups) {
    map.set(group.id, { group, children: [] })
  }

  // Link parent-child
  for (const group of groups) {
    const node = map.get(group.id)!
    if (group.parent_id && map.has(group.parent_id)) {
      map.get(group.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

// ============================================================================
// Single tree node component
// ============================================================================

interface TreeNodeItemProps {
  node: TreeNode
  level: number
  selectedId?: string
  expandedIds: Set<string>
  onToggle: (id: string) => void
  onSelect?: (group: MaterialGroup) => void
}

function TreeNodeItem({
  node,
  level,
  selectedId,
  expandedIds,
  onToggle,
  onSelect,
}: TreeNodeItemProps) {
  const { group, children } = node
  const hasChildren = children.length > 0
  const isExpanded = expandedIds.has(group.id)
  const isSelected = selectedId === group.id

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          if (hasChildren) {
            onToggle(group.id)
          }
          onSelect?.(group)
        }}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          isSelected && 'bg-accent text-accent-foreground font-medium'
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        {/* Expand arrow */}
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {hasChildren && (
            <ChevronRight
              className={cn(
                'h-3.5 w-3.5 text-muted-foreground transition-transform duration-150',
                isExpanded && 'rotate-90'
              )}
            />
          )}
        </span>

        {/* Folder icon */}
        {isExpanded && hasChildren ? (
          <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
        ) : (
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}

        {/* Label */}
        <span className="truncate">
          {group.code && (
            <span className="mr-1.5 text-xs text-muted-foreground">
              [{group.code}]
            </span>
          )}
          {group.name}
        </span>
      </button>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div>
          {children.map((child) => (
            <TreeNodeItem
              key={child.group.id}
              node={child}
              level={level + 1}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Main tree component
// ============================================================================

interface MaterialGroupTreeProps {
  selectedId?: string
  onSelect?: (group: MaterialGroup) => void
  className?: string
}

export function MaterialGroupTree({
  selectedId,
  onSelect,
  className,
}: MaterialGroupTreeProps) {
  const { data: groups = [], isLoading } = useMaterialGroups()
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const tree = useMemo(() => buildTree(groups), [groups])

  const handleToggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-8', className)}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">
          Загрузка групп...
        </span>
      </div>
    )
  }

  if (tree.length === 0) {
    return (
      <div className={cn('py-8 text-center', className)}>
        <Folder className="mx-auto h-8 w-8 text-muted-foreground/50" />
        <p className="mt-2 text-sm text-muted-foreground">
          Группы материалов не созданы
        </p>
      </div>
    )
  }

  return (
    <div className={cn('space-y-0.5', className)}>
      {/* "All materials" root option */}
      <button
        type="button"
        onClick={() => onSelect?.({ id: '', name: 'Все материалы', parent_id: null, code: null, created_at: '' })}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          !selectedId && 'bg-accent text-accent-foreground font-medium'
        )}
      >
        <span className="flex h-4 w-4 shrink-0" />
        <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span>Все материалы</span>
      </button>

      {tree.map((node) => (
        <TreeNodeItem
          key={node.group.id}
          node={node}
          level={0}
          selectedId={selectedId}
          expandedIds={expandedIds}
          onToggle={handleToggle}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
