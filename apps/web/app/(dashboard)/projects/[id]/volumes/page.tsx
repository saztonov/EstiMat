import { VolumeListWidget } from '@/widgets/volume-list'

interface Props {
  params: Promise<{ id: string }>
}

export default async function VolumesPage({ params }: Props) {
  const { id } = await params
  return <VolumeListWidget projectId={id} />
}
