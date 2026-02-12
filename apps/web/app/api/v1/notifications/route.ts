import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/shared/lib/supabase/server'
import { z } from 'zod'

const createNotificationSchema = z.object({
  user_id: z.string().uuid('Invalid user ID'),
  title: z.string().min(1, 'Title is required').max(255),
  message: z.string().min(1, 'Message is required').max(5000),
  entity_type: z.string().max(100).nullable().optional(),
  entity_id: z.string().uuid('Invalid entity ID').nullable().optional(),
})

export async function GET(request: NextRequest) {
  const supabase = createClient()
  const { searchParams } = new URL(request.url)
  const user_id = searchParams.get('user_id')
  const is_read = searchParams.get('is_read')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '20')
  const offset = (page - 1) * limit

  // If no user_id is provided, try to get the current user
  let targetUserId = user_id

  if (!targetUserId) {
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser()
    targetUserId = authUser?.id || null
  }

  if (!targetUserId) {
    return NextResponse.json(
      { data: null, error: 'user_id is required' },
      { status: 400 }
    )
  }

  let query = supabase
    .from('notifications')
    .select('*', { count: 'exact' })
    .eq('user_id', targetUserId)

  if (is_read !== null && is_read !== undefined) {
    query = query.eq('is_read', is_read === 'true')
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
  const parsed = createNotificationSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('notifications')
    .insert({
      ...parsed.data,
      is_read: false,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data }, { status: 201 })
}
