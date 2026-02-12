import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/shared/lib/supabase/server'
import { z } from 'zod'

const awardSchema = z.object({
  lot_id: z.string().uuid('Invalid lot ID'),
  supplier_id: z.string().uuid('Invalid supplier ID'),
  price: z.number().nonnegative('Price must be non-negative'),
})

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const body = await request.json()
  const parsed = awardSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.flatten() }, { status: 400 })
  }

  const { lot_id, supplier_id, price } = parsed.data

  // Verify the lot belongs to this tender
  const { data: lot, error: lotError } = await supabase
    .from('tender_lots')
    .select('*')
    .eq('id', lot_id)
    .eq('tender_id', params.id)
    .single()

  if (lotError || !lot) {
    return NextResponse.json(
      { data: null, error: 'Lot not found in this tender' },
      { status: 404 }
    )
  }

  // Update tender status to awarded
  const { data: tender, error: tenderError } = await supabase
    .from('tenders')
    .update({
      status: 'awarded',
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .select()
    .single()

  if (tenderError) {
    return NextResponse.json({ data: null, error: tenderError.message }, { status: 500 })
  }

  return NextResponse.json({
    data: {
      tender,
      award: {
        lot_id,
        supplier_id,
        price,
        total_quantity: lot.total_quantity,
        unit: lot.unit,
      },
    },
  })
}
