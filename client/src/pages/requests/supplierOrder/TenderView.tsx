import { Button, Space, Descriptions, Popconfirm } from 'antd';
import { ItemsTable } from './ItemsTable';
import type { SupplierOrderDetail } from '../types';

/**
 * Компактный вид тендерного заказа: состав read-only + статус площадки. Ручные этапы (сбор КП,
 * выбор победителя, цены) здесь неприменимы — победителя определяет портал.
 */
export function TenderView({ order, onRefresh, onAward }: {
  order: SupplierOrderDetail;
  onRefresh: () => void;
  onAward: (participantId: string) => void;
}) {
  const res = order.tender_results;
  const winnerId = res?.winner?.participant_id;
  const finished = order.tender_status === 'finished';
  return (
    <>
      <Descriptions size="small" column={2} style={{ marginBottom: 12 }}>
        <Descriptions.Item label="Статус">{order.tender_sync_status === 'pending' ? 'В очереди на выгрузку' : order.tender_sync_status === 'failed' ? 'Ошибка выгрузки' : (order.tender_status ?? '—')}</Descriptions.Item>
        <Descriptions.Item label="Портал">{order.tender_url ? <a href={order.tender_url} target="_blank" rel="noopener noreferrer">Открыть</a> : '—'}</Descriptions.Item>
      </Descriptions>
      <ItemsTable order={order} />
      <Space style={{ marginTop: 12 }}>
        <Button onClick={onRefresh}>Обновить результаты</Button>
        {finished && winnerId && res?.outcome !== 'no_award' && (
          <Popconfirm title="Зафиксировать победителя тендера?" onConfirm={() => onAward(winnerId)}>
            <Button type="primary">Зафиксировать победителя</Button>
          </Popconfirm>
        )}
      </Space>
    </>
  );
}
