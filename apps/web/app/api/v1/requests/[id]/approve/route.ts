import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/shared/lib/supabase/server'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const body = await request.json().catch(() => ({}))
  const approved_by = body.approved_by || null

  // Update request status to approved
  const { data: pr, error: prError } = await supabase
    .from('purchase_requests')
    .update({
      status: 'approved',
      approved_by,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .select()
    .single()

  if (prError) {
    return NextResponse.json({ data: null, error: prError.message }, { status: 500 })
  }

  // Funding type routing: trigger the appropriate downstream flow
  // For gp_supply: pr_items go to tender consolidation (status remains pending)
  // For obs_letter: create distribution_letter placeholder if not exists
  // For advance: create advance placeholder if not exists

  if (pr.funding_type === 'obs_letter') {
    const { data: existing } = await supabase
      .from('distribution_letters')
      .select('id')
      .eq('request_id', params.id)
      .maybeSingle()

    if (!existing) {
      await supabase.from('distribution_letters').insert({
        request_id: params.id,
        obs_account: '',
        amount: pr.total || 0,
        status: 'draft',
      })
    }
  } else if (pr.funding_type === 'advance') {
    const { data: existing } = await supabase
      .from('advances')
      .select('id')
      .eq('request_id', params.id)
      .maybeSingle()

    if (!existing) {
      await supabase.from('advances').insert({
        request_id: params.id,
        contractor_id: pr.contractor_id,
        amount: pr.total || 0,
        status: 'draft',
      })
    }
  }

  return NextResponse.json({ data: pr })
}
