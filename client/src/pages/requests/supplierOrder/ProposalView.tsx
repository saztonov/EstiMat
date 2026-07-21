import { Table, Descriptions } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  MANUAL_VAT_RATE_LABELS, MANUAL_VAT_RATE_VALUE, PAYMENT_TYPE_LABELS,
  type ManualVatRate, type PaymentType,
} from '@estimat/shared';
import { money, round4 } from '../requestConstants';
import type { SupplierOrderDetail, OrderAggItem } from '../types';

const roundMoney = (v: number) => Math.round(v * 100) / 100;

/**
 * Условия выбранного поставщика: одна и та же разметка для согласования и для присуждённого
 * заказа — это одни и те же условия, только до и после подтверждения.
 */
export function ProposalView({ order }: { order: SupplierOrderDetail }) {
  const rate = order.vat_rate ? Number(MANUAL_VAT_RATE_VALUE[order.vat_rate as ManualVatRate]) : 0;
  const priceByKey = new Map(order.priceLines.map((p) => [p.agg_key, p]));
  const cols: ColumnsType<OrderAggItem> = [
    { title: 'Материал', dataIndex: 'material_name', key: 'm' },
    { title: 'Ед.', dataIndex: 'unit', key: 'u', width: 64 },
    { title: 'Кол-во', dataIndex: 'quantity', key: 'q', width: 90, align: 'right', render: (v) => round4(v) },
    { title: 'Цена', key: 'p', width: 110, align: 'right', render: (_, a) => money(priceByKey.get(a.agg_key)?.unit_price ?? 0) },
    { title: 'Гар., мес.', key: 'w', width: 90, align: 'right', render: (_, a) => priceByKey.get(a.agg_key)?.warranty_months ?? '—' },
    { title: 'Сумма НДС', key: 'v', width: 110, align: 'right', render: (_, a) => { const net = roundMoney(Number(a.quantity) * Number(priceByKey.get(a.agg_key)?.unit_price ?? 0)); return money(roundMoney(net * rate)); } },
    { title: 'Сумма', key: 's', width: 120, align: 'right', render: (_, a) => { const net = roundMoney(Number(a.quantity) * Number(priceByKey.get(a.agg_key)?.unit_price ?? 0)); return <strong>{money(net + roundMoney(net * rate))}</strong>; } },
  ];
  return (
    <>
      <Descriptions size="small" column={2} bordered style={{ marginBottom: 12 }}>
        <Descriptions.Item label="Поставщик">{order.supplier_name ?? '—'}{order.supplier_inn ? `, ИНН ${order.supplier_inn}` : ''}</Descriptions.Item>
        <Descriptions.Item label="Сумма">{money(order.amount)}</Descriptions.Item>
        <Descriptions.Item label="НДС">{order.vat_rate ? MANUAL_VAT_RATE_LABELS[order.vat_rate as ManualVatRate] : '—'}</Descriptions.Item>
        <Descriptions.Item label="Тип поставки">{order.payment_type ? PAYMENT_TYPE_LABELS[order.payment_type as PaymentType] : '—'}</Descriptions.Item>
      </Descriptions>
      <Table rowKey="agg_key" size="small" pagination={false} dataSource={order.aggItems} columns={cols} scroll={{ x: 720 }}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={6}><strong>ИТОГО</strong></Table.Summary.Cell>
            <Table.Summary.Cell index={6} align="right"><strong>{money(order.amount)}</strong></Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />
    </>
  );
}
