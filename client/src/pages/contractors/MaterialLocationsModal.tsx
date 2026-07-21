import { useMemo } from 'react';
import { Modal, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { MaterialOccurrence } from '../estimates/materials/aggregateMaterials';
import { LocationBadgesRow, locationParts, type ZoneIndex } from '../estimates/components/LocationBadges';
import { formatMoney } from '../estimates/components/types';
import { modalWidth } from '../../lib/modalWidth';
import type { OrderMaterialRow } from './materials/orderRow';

interface Props {
  material: OrderMaterialRow;
  zoneIndex: ZoneIndex;
  onClose: () => void;
}

// Строка разбивки: одна работа-источник с её местоположением, типом и вкладом в итог.
interface WorkRow {
  key: string;
  workName: string;
  zoneNames: string[];
  floorsLabel: string;
  typeLabels: string[];
  quantity: number;
  total: number;
}

const qty = (n: number) => Math.round(n * 1e4) / 1e4;

// Свернуть вхождения по работе: у материала может быть несколько строк в одной работе,
// и показывать их порознь бессмысленно — сметчику нужен вклад работы целиком.
function buildRows(occurrences: MaterialOccurrence[], zoneIndex: ZoneIndex): WorkRow[] {
  const byWork = new Map<string, WorkRow>();
  for (const occ of occurrences) {
    let row = byWork.get(occ.workId);
    if (!row) {
      const { zoneNames, floorsLabel, typeLabel } = locationParts(occ.location, zoneIndex);
      row = {
        key: occ.workId,
        workName: occ.workName,
        zoneNames,
        floorsLabel,
        typeLabels: typeLabel ? [typeLabel] : [],
        quantity: 0,
        total: 0,
      };
      byWork.set(occ.workId, row);
    }
    row.quantity += occ.quantity;
    row.total += occ.total;
  }
  return [...byWork.values()].sort((a, b) => b.quantity - a.quantity);
}

// Разбивка сводной строки материала: из каких работ она получена, с какими местоположениями,
// типами и исходными количествами. Категория и вид работ — в шапке: строка свода атомарна по
// виду работ, поэтому у всех её вхождений они одинаковы.
export function MaterialLocationsModal({ material, zoneIndex, onClose }: Props) {
  const rows = useMemo(() => buildRows(material.occurrences, zoneIndex), [material.occurrences, zoneIndex]);

  const columns: ColumnsType<WorkRow> = [
    { title: 'Работа', dataIndex: 'workName', key: 'workName' },
    {
      title: 'Местоположение',
      key: 'location',
      width: 260,
      render: (_, r) => (
        <LocationBadgesRow zoneNames={r.zoneNames} floorsLabel={r.floorsLabel} typeLabels={r.typeLabels} />
      ),
    },
    {
      title: 'Кол-во',
      key: 'quantity',
      width: 120,
      align: 'right',
      render: (_, r) => `${qty(r.quantity)} ${material.unit}`,
    },
    { title: 'Сумма', key: 'total', width: 140, align: 'right', render: (_, r) => formatMoney(r.total) },
  ];

  return (
    <Modal
      open
      title={
        <Space direction="vertical" size={0}>
          <span>{material.name}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
            {material.category.name ?? 'Без категории'} · {material.costTypeName ?? 'Без вида работ'}
          </Typography.Text>
        </Space>
      }
      width={modalWidth(860)}
      footer={null}
      onCancel={onClose}
    >
      <Table<WorkRow>
        rowKey="key"
        size="small"
        className="estimat-compact"
        pagination={false}
        dataSource={rows}
        columns={columns}
        scroll={{ x: 720 }}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0}>
              <strong>Итого</strong>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={1} />
            <Table.Summary.Cell index={2} align="right">
              <strong>
                {qty(material.quantity)} {material.unit}
              </strong>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={3} align="right">
              <strong>{formatMoney(material.total)}</strong>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />
    </Modal>
  );
}
