import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/shared/lib/supabase/server'
import { updatePurchaseRequestSchema } from '@estimat/shared'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()

  // Fetch main request with relations
  const { data: pr, error: prError } = await supabase
    .from('purchase_requests')
    .select(
      '*, contractor:organizations(id, name), estimate:estimates(id, work_type, total_amount), creator:users!created_by(id, full_name), approver:users!approved_by(id, full_name)'
    )
    .eq('id', params.id)
    .single()

  if (prError) {
    return NextResponse.json({ data: null, error: prError.message }, { status: 404 })
  }

  // Fetch items
  const { data: items, error: itemsError } = await supabase
    .from('pr_items')
    .select('*, material:material_catalog(id, name, unit)')
    .eq('request_id', params.id)
    .order('created_at', { ascending: true })

  if (itemsError) {
    return NextResponse.json({ data: null, error: itemsError.message }, { status: 500 })
  }

  // Fetch distribution letter if exists
  const { data: distributionLetter } = await supabase
    .from('distribution_letters')
    .select('*')
    .eq('request_id', params.id)
    .maybeSingle()

  // Fetch advance if exists
  const { data: advance } = await supabase
    .from('advances')
    .select('*')
    .eq('request_id', params.id)
    .maybeSingle()

  return NextResponse.json({
    data: {
      ...pr,
      items,
      distribution_letter: distributionLetter,
      advance,
    },
  })
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const body = await request.json()
  const parsed = updatePurchaseRequestSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('purchase_requests')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}
