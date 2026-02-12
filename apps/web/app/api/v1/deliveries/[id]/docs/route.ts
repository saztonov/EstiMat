import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/shared/lib/supabase/server'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('acceptance_docs')
    .select('*, signer:users!signed_by(id, full_name)')
    .eq('delivery_id', params.id)
    .order('created_at', { ascending: true })

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

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const type = formData.get('type') as string | null
  const notes = formData.get('notes') as string | null
  const signed_by = formData.get('signed_by') as string | null

  if (!file) {
    return NextResponse.json(
      { data: null, error: 'File is required' },
      { status: 400 }
    )
  }

  if (!type) {
    return NextResponse.json(
      { data: null, error: 'Document type is required' },
      { status: 400 }
    )
  }

  // Upload file to Supabase Storage bucket 'acceptance-docs'
  const filePath = `${params.id}/${Date.now()}_${file.name}`
  const { error: uploadError } = await supabase.storage
    .from('acceptance-docs')
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

  // Create acceptance_docs record
  const { data, error } = await supabase
    .from('acceptance_docs')
    .insert({
      delivery_id: params.id,
      type,
      file_path: filePath,
      notes: notes ?? null,
      signed_by: signed_by ?? null,
      signed_at: signed_by ? new Date().toISOString() : null,
    })
    .select()
    .single()

  if (error) {
    await supabase.storage.from('acceptance-docs').remove([filePath])
    return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data }, { status: 201 })
}
