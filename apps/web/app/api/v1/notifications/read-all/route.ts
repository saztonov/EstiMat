import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/shared/lib/supabase/server'
import { z } from 'zod'

const readAllSchema = z.object({
  user_id: z.string().uuid('Invalid user ID').optional(),
})

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const body = await request.json().catch(() => ({}))
  const parsed = readAllSchema.safeParse(body)

  let targetUserId: string | null = null

  if (parsed.success && parsed.data.user_id) {
    targetUserId = parsed.data.user_id
  } else {
    // Try to get the current user from auth
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

  const { data, error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', targetUserId)
    .eq('is_read', false)
    .select()

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    data: null,
    message: `Marked ${data?.length || 0} notifications as read`,
  })
}
