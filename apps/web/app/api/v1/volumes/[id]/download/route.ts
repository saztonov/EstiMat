import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/shared/lib/supabase/server'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()

  // First fetch the volume to get the file_path
  const { data: volume, error: fetchError } = await supabase
    .from('rd_volumes')
    .select('file_path, title')
    .eq('id', params.id)
    .single()

  if (fetchError || !volume) {
    return NextResponse.json(
      { data: null, error: 'Volume not found' },
      { status: 404 }
    )
  }

  // Generate signed URL (valid for 1 hour)
  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from('rd-volumes')
    .createSignedUrl(volume.file_path, 3600)

  if (signedUrlError || !signedUrlData) {
    return NextResponse.json(
      { data: null, error: `Failed to generate download URL: ${signedUrlError?.message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({
    data: {
      url: signedUrlData.signedUrl,
      title: volume.title,
      expires_in: 3600,
    },
  })
}
