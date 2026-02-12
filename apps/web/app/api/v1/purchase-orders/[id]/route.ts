import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/shared/lib/supabase/server'
import { updatePurchaseOrderSchema } from '@estimat/shared'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()

  const { data: po, error: poError } = await supabase
    .from('purchase_orders')
    .select(
      '*, supplier:organizations(*), project:projects(id, name), contract:contracts(id, number, date), creator:users!created_by(id, full_name)'
    )
    .eq('id', params.id)
    .single()

  if (poError) {
    return NextResponse.json({ data: null, error: poError.message }, { status: 404 })
  }

  // Fetch items
  const { data: items, error: itemsError } = await supabase
    .from('po_items')
    .select('*, material:material_catalog(id, name, unit), lot:tender_lots(id, total_quantity)')
    .eq('order_id', params.id)
    .order('created_at', { ascending: true })

  if (itemsError) {
    return NextResponse.json({ data: null, error: itemsError.message }, { status: 500 })
  }

  return NextResponse.json({ data: { ...po, items } })
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const body = await request.json()
  const parsed = updatePurchaseOrderSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('purchase_orders')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}
