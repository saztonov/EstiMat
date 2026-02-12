import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/shared/lib/supabase/server'
import { uploadVolumeSchema } from '@estimat/shared'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '20')
  const offset = (page - 1) * limit

  let query = supabase
    .from('rd_volumes')
    .select('*, uploader:users!uploaded_by(id, full_name)', { count: 'exact' })
    .eq('project_id', params.id)

  if (status) {
    query = query.eq('status', status)
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

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const title = formData.get('title') as string | null
  const code = formData.get('code') as string | null
  const uploaded_by = formData.get('uploaded_by') as string | null

  if (!file) {
    return NextResponse.json(
      { data: null, error: 'File is required' },
      { status: 400 }
    )
  }

  const parsed = uploadVolumeSchema.safeParse({
    project_id: params.id,
    title: title || file.name,
    code,
  })

  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.flatten() }, { status: 400 })
  }

  // Upload file to Supabase Storage bucket 'rd-volumes'
  const filePath = `${params.id}/${Date.now()}_${file.name}`
  const { error: uploadError } = await supabase.storage
    .from('rd-volumes')
    .upload(filePath, file, {
      contentType: file.type,
      upsert: false,
    })

  if (uploadError) {
    return NextResponse.json(
      { data: null, error: `File upload failed: ${uploadError.message}` },
      { status: 500 }
    )
  }

  // Create rd_volumes record
  const { data, error } = await supabase
    .from('rd_volumes')
    .insert({
      project_id: parsed.data.project_id,
      title: parsed.data.title,
      code: parsed.data.code ?? null,
      file_path: filePath,
      file_size_bytes: file.size,
      uploaded_by: uploaded_by || '',
    })
    .select()
    .single()

  if (error) {
    // Clean up uploaded file on DB insert failure
    await supabase.storage.from('rd-volumes').remove([filePath])
    return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data }, { status: 201 })
}
