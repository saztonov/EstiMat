import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/shared/lib/supabase/server'
import { updateTenderSchema } from '@estimat/shared'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()

  const { data: tender, error: tenderError } = await supabase
    .from('tenders')
    .select(
      '*, material_group:material_groups(id, name, code), project:projects(id, name), creator:users!created_by(id, full_name)'
    )
    .eq('id', params.id)
    .single()

  if (tenderError) {
    return NextResponse.json({ data: null, error: tenderError.message }, { status: 404 })
  }

  // Fetch lots with materials
  const { data: lots, error: lotsError } = await supabase
    .from('tender_lots')
    .select('*, material:material_catalog(id, name, unit)')
    .eq('tender_id', params.id)
    .order('created_at', { ascending: true })

  if (lotsError) {
    return NextResponse.json({ data: null, error: lotsError.message }, { status: 500 })
  }

  return NextResponse.json({ data: { ...tender, lots } })
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const body = await request.json()
  const parsed = updateTenderSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('tenders')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}
