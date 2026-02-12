import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/shared/lib/supabase/server'
import { updateDeliverySchema } from '@estimat/shared'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()

  const { data: delivery, error: deliveryError } = await supabase
    .from('deliveries')
    .select(
      '*, order:purchase_orders(id, supplier_id, total, contract_id), project:projects(id, name), receiver:organizations(id, name)'
    )
    .eq('id', params.id)
    .single()

  if (deliveryError) {
    return NextResponse.json({ data: null, error: deliveryError.message }, { status: 404 })
  }

  // Fetch delivery items
  const { data: items, error: itemsError } = await supabase
    .from('delivery_items')
    .select('*, po_item:po_items(id, material_id, quantity, unit_price)')
    .eq('delivery_id', params.id)
    .order('created_at', { ascending: true })

  if (itemsError) {
    return NextResponse.json({ data: null, error: itemsError.message }, { status: 500 })
  }

  // Fetch acceptance docs
  const { data: docs, error: docsError } = await supabase
    .from('acceptance_docs')
    .select('*')
    .eq('delivery_id', params.id)
    .order('created_at', { ascending: true })

  if (docsError) {
    return NextResponse.json({ data: null, error: docsError.message }, { status: 500 })
  }

  return NextResponse.json({ data: { ...delivery, items, docs } })
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const body = await request.json()
  const parsed = updateDeliverySchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('deliveries')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}
