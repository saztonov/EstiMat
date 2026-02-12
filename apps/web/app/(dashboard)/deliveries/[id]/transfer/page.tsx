import { TransferFormWidget } from '@/widgets/transfer-form'

interface Props {
  params: Promise<{ id: string }>
}

export default async function DeliveryTransferPage({ params }: Props) {
  const { id } = await params
  return <TransferFormWidget deliveryId={id} />
}
