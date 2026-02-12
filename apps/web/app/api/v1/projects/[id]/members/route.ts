import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/shared/lib/supabase/server'
import { addProjectMemberSchema } from '@estimat/shared'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('project_members')
    .select('*, user:users(id, email, full_name, role, phone)')
    .eq('project_id', params.id)

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const body = await request.json()
  const parsed = addProjectMemberSchema.safeParse({
    ...body,
    project_id: params.id,
  })

  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('project_members')
    .insert(parsed.data)
    .select('*, user:users(id, email, full_name, role, phone)')
    .single()

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data }, { status: 201 })
}
