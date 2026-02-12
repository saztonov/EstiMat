import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/shared/lib/supabase/server'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const body = await request.json().catch(() => ({}))
  const approved = body.approved !== false // default to true

  const newStatus = approved ? 'approved' : 'rejected'

  const { data, error } = await supabase
    .from('rd_volumes')
    .update({
      status: newStatus,
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
