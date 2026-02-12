import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/shared/lib/supabase/server'
import { createMaterialGroupSchema } from '@estimat/shared'

export async function GET(request: NextRequest) {
  const supabase = createClient()

  // Fetch all groups to build a tree structure on the client
  const { data, error } = await supabase
    .from('material_groups')
    .select('*')
    .order('name', { ascending: true })

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  }

  // Build tree structure: nest children under their parent nodes
  interface GroupNode {
    id: string
    name: string
    parent_id: string | null
    code: string | null
    created_at: string
    children: GroupNode[]
  }

  const groupMap = new Map<string, GroupNode>()
  const roots: GroupNode[] = []

  // First pass: create node for each group
  for (const group of data ?? []) {
    groupMap.set(group.id, { ...group, children: [] })
  }

  // Second pass: build the tree
  for (const group of data ?? []) {
    const node = groupMap.get(group.id)!
    if (group.parent_id && groupMap.has(group.parent_id)) {
      groupMap.get(group.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return NextResponse.json({ data: roots })
}

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const body = await request.json()
  const parsed = createMaterialGroupSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('material_groups')
    .insert(parsed.data)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data }, { status: 201 })
}
