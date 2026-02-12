import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/shared/lib/supabase/server'
import { createContractSchema } from '@estimat/shared'

export async function GET(request: NextRequest) {
  const supabase = createClient()
  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search') || ''
  const status = searchParams.get('status')
  const supplier_id = searchParams.get('supplier_id')
  const project_id = searchParams.get('project_id')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '20')
  const offset = (page - 1) * limit

  let query = supabase
    .from('contracts')
    .select('*, supplier:organizations(id, name), project:projects(id, name)', { count: 'exact' })

  if (search) {
    query = query.ilike('number', `%${search}%`)
  }
  if (status) {
    query = query.eq('status', status)
  }
  if (supplier_id) {
    query = query.eq('supplier_id', supplier_id)
  }
  if (project_id) {
    query = query.eq('project_id', project_id)
  }

  query = query
    .range(offset, offset + limit - 1)
    .order('created_at', { ascending: false })

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data, meta: { total: count, page, limit } })
}

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const body = await request.json()
  const parsed = createContractSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('contracts')
    .insert(parsed.data)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data }, { status: 201 })
}
