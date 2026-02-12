import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/shared/lib/supabase/server'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; memberId: string } }
) {
  const supabase = createClient()

  const { error } = await supabase
    .from('project_members')
    .delete()
    .eq('id', params.memberId)
    .eq('project_id', params.id)

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: null, message: 'Member removed from project' })
}
