import { VolumeDetailWidget } from '@/widgets/volume-detail'

interface Props {
  params: Promise<{ id: string; volumeId: string }>
}

export default async function VolumeDetailPage({ params }: Props) {
  const { id, volumeId } = await params
  return <VolumeDetailWidget volumeId={volumeId} projectId={id} />
}
