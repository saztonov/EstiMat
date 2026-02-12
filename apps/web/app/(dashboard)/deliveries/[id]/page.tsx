import { DeliveryDetailWidget } from '@/widgets/delivery-detail'

interface Props {
  params: Promise<{ id: string }>
}

export default async function DeliveryDetailPage({ params }: Props) {
  const { id } = await params
  return <DeliveryDetailWidget deliveryId={id} />
}
