import { useMemo, useState } from 'react';
import { Modal, Table, Tabs, Descriptions, Tag, Space, Typography } from 'antd';
import { DeliveryGantt, type GanttMaterial } from '../contractors/DeliveryGantt';
import { modalWidth } from '../../lib/modalWidth';
import { round4, requestNumber } from './requestConstants';
import { RequestDetailModal } from './RequestDetailModal';
import type { Su10MaterialGroupRow } from './types';

const { Text } = Typography;

/**
 * График поставок материала (только просмотр). Строка свода схлопнута по датам, поэтому детали
 * нужны отдельным окном: по каким датам и в каком количестве материал заявлен, сколько уже
 * заказано и сколько осталось.
 *
 * Редактирование графика живёт в карточке заявки — второй точки правки быть не должно.
 */
const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};

export function MaterialScheduleModal({ row, onClose }: { row: Su10MaterialGroupRow; onClose: () => void }) {
  const [openRequestId, setOpenRequestId] = useState<string | null>(null);

  const rows = useMemo(() => row.items.map((it) => {
    const requested = Number(it.requested);
    const placed = Number(it.placed);
    return {
      key: it.request_item_id,
      requestId: it.request_id,
      requestNo: it.request_no,
      date: it.delivery_date,
      requested,
      placed,
      left: requested - placed,
    };
  }), [row.items]);

  // Для диаграммы берём только строки с датой: без неё позицию не на что положить на шкале.
  const gantt: GanttMaterial[] = useMemo(() => {
    const schedule = rows.filter((r) => r.date).map((r) => ({ date: r.date as string, qty: r.requested }));
    if (!schedule.length) return [];
    return [{
      key: row.row_key,
      name: row.material_name,
      unit: row.unit,
      totalQty: Number(row.requested),
      schedule,
    }];
  }, [rows, row]);

  const items = [
    {
      key: 'dates',
      label: `Даты (${rows.length})`,
      children: (
        <Table
          rowKey="key" size="small" pagination={false}
          dataSource={rows}
          columns={[
            { title: 'Дата поставки', dataIndex: 'date', width: 140, render: (v: string | null) => fmtDate(v) },
            {
              title: 'Заявка', dataIndex: 'requestNo', width: 110,
              render: (_v: unknown, r: (typeof rows)[number]) => (
                <a onClick={() => setOpenRequestId(r.requestId)}>
                  {requestNumber(row.project_code, r.requestNo ?? 0)}
                </a>
              ),
            },
            { title: 'Запрошено', dataIndex: 'requested', width: 110, align: 'right', render: (v: number) => round4(v) },
            { title: 'Заказано', dataIndex: 'placed', width: 110, align: 'right', render: (v: number) => round4(v) },
            {
              title: 'Осталось', dataIndex: 'left', width: 110, align: 'right',
              render: (v: number) => (v < 0
                ? <Text type="danger">{round4(v)}</Text>
                : <strong style={{ color: v > 0 ? '#1677ff' : '#bfbfbf' }}>{round4(v)}</strong>),
            },
          ]}
        />
      ),
    },
    ...(gantt.length ? [{ key: 'gantt', label: 'График', children: <DeliveryGantt materials={gantt} /> }] : []),
  ];

  return (
    <>
      <Modal
        open
        title={<Space size={6}>{row.material_name}<Tag>{row.unit}</Tag></Space>}
        onCancel={onClose}
        footer={null}
        width={modalWidth(820)}
        destroyOnClose
      >
        <Descriptions size="small" column={2} style={{ marginBottom: 12 }}>
          <Descriptions.Item label="Объект">
            {row.project_name ? `${row.project_code ? `${row.project_code} · ` : ''}${row.project_name}` : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Подрядчик">{row.contractor_name ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Вид работ">{row.cost_type_name ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Ответственный">
            {row.responsible?.full_name ?? <span style={{ color: '#bfbfbf' }}>не назначен</span>}
          </Descriptions.Item>
          <Descriptions.Item label="Запрошено">{round4(row.requested)}</Descriptions.Item>
          <Descriptions.Item label="Заказано">{round4(row.ordered ?? 0)}</Descriptions.Item>
          <Descriptions.Item label="Осталось заказать">
            <strong>{round4(row.remaining ?? 0)}</strong>
            {row.has_overplaced && <Tag color="red" style={{ marginLeft: 6 }}>перезаказ {round4(row.overplaced)}</Tag>}
          </Descriptions.Item>
        </Descriptions>

        <Tabs size="small" items={items} />
      </Modal>
      <RequestDetailModal id={openRequestId} onClose={() => setOpenRequestId(null)} />
    </>
  );
}
