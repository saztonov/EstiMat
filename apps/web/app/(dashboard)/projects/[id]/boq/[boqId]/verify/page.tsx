import { BoqVerifyWidget } from '@/widgets/boq-verify'

interface Props {
  params: Promise<{ id: string; boqId: string }>
}

export default async function BoqVerifyPage({ params }: Props) {
  const { id, boqId } = await params
  return <BoqVerifyWidget boqId={boqId} projectId={id} />
}
