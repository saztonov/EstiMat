import { BoqEditorWidget } from '@/widgets/boq-editor'

interface Props {
  params: Promise<{ id: string; boqId: string }>
}

export default async function BoqEditorPage({ params }: Props) {
  const { id, boqId } = await params
  return <BoqEditorWidget boqId={boqId} projectId={id} />
}
