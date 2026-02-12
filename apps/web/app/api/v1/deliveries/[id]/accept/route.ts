import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/shared/lib/supabase/server'
import { acceptDeliverySchema } from '@estimat/shared'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const body = await request.json()
  const parsed = acceptDeliverySchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.flatten() }, { status: 400 })
  }

  const errors: string[] = []

  // Update each delivery item with acceptance quantities
  for (const item of parsed.data.items) {
    const { error: itemError } = await supabase
      .from('delivery_items')
      .update({
        accepted_qty: item.accepted_qty,
        rejected_qty: item.rejected_qty,
        rejection_reason: item.rejection_reason ?? null,
      })
      .eq('id', item.delivery_item_id)
      .eq('delivery_id', params.id)

    if (itemError) {
      errors.push(`Item ${item.delivery_item_id}: ${itemError.message}`)
    }
  }

  if (errors.length > 0) {
    return NextResponse.json(
      { data: null, error: `Failed to update some items: ${errors.join('; ')}` },
      { status: 500 }
    )
  }

  // Determine overall delivery status based on acceptance
  const { data: updatedItems } = await supabase
    .from('delivery_items')
    .select('shipped_qty, accepted_qty, rejected_qty')
    .eq('delivery_id', params.id)

  let deliveryStatus: 'accepted' | 'partially_accepted' | 'rejected' = 'accepted'
  if (updatedItems) {
    const totalShipped = updatedItems.reduce((s, i) => s + Number(i.shipped_qty), 0)
    const totalAccepted = updatedItems.reduce((s, i) => s + Number(i.accepted_qty), 0)
    const totalRejected = updatedItems.reduce((s, i) => s + Number(i.rejected_qty), 0)

    if (totalRejected === totalShipped) {
      deliveryStatus = 'rejected'
    } else if (totalAccepted < totalShipped) {
      deliveryStatus = 'partially_accepted'
    } else {
      deliveryStatus = 'accepted'
    }
  }

  // Update delivery status
  const { data, error } = await supabase
    .from('deliveries')
    .update({
      status: deliveryStatus,
      actual_date: new Date().toISOString().split('T')[0],
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}
