import { DeliveryAcceptanceWidget } from '@/widgets/delivery-acceptance'

interface Props {
  params: Promise<{ id: string }>
}

export default async function DeliveryAcceptPage({ params }: Props) {
  const { id } = await params
  return <DeliveryAcceptanceWidget deliveryId={id} />
}
