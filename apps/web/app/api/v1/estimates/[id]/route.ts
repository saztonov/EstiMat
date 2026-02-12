import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/shared/lib/supabase/server'
import { updateEstimateSchema } from '@estimat/shared'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()

  const { data: estimate, error: estError } = await supabase
    .from('estimates')
    .select(
      '*, contractor:organizations(id, name), boq:boq(id, version, status), creator:users!created_by(id, full_name), approver:users!approved_by(id, full_name)'
    )
    .eq('id', params.id)
    .single()

  if (estError) {
    return NextResponse.json({ data: null, error: estError.message }, { status: 404 })
  }

  // Fetch items
  const { data: items, error: itemsError } = await supabase
    .from('estimate_items')
    .select('*, boq_item:boq_items(id, work_type, material_quantity, unit)')
    .eq('estimate_id', params.id)
    .order('sort_order', { ascending: true })

  if (itemsError) {
    return NextResponse.json({ data: null, error: itemsError.message }, { status: 500 })
  }

  return NextResponse.json({ data: { ...estimate, items } })
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const body = await request.json()
  const parsed = updateEstimateSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('estimates')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}
