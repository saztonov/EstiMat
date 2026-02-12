import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/shared/lib/supabase/server'
import { updateBoqSchema } from '@estimat/shared'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()

  const { data: boq, error: boqError } = await supabase
    .from('boq')
    .select('*, creator:users!created_by(id, full_name), approver:users!approved_by(id, full_name)')
    .eq('id', params.id)
    .single()

  if (boqError) {
    return NextResponse.json({ data: null, error: boqError.message }, { status: 404 })
  }

  // Fetch items with relations
  const { data: items, error: itemsError } = await supabase
    .from('boq_items')
    .select('*, material:material_catalog(id, name, unit), volume:rd_volumes(id, title)')
    .eq('boq_id', params.id)
    .order('sort_order', { ascending: true })

  if (itemsError) {
    return NextResponse.json({ data: null, error: itemsError.message }, { status: 500 })
  }

  return NextResponse.json({ data: { ...boq, items } })
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const body = await request.json()
  const parsed = updateBoqSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('boq')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}
