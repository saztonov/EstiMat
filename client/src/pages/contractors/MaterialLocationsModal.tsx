import { useMemo } from 'react';
import { Modal, Table, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { AggregatedMaterial, MaterialOccurrence } from '../estimates/materials/aggregateMaterials';
import { LocationBadgesRow, locationKey, locationParts, type ZoneIndex } from '../estimates/components/LocationBadges';
import { formatMoney } from '../estimates/components/types';
import { modalWidth } from '../../lib/modalWidth';

interface Props {
  material: AggregatedMaterial;
  zoneIndex: ZoneIndex;
  onClose: () => void;
}

// Строка разбивки: одна локация (+тип) с суммарным объёмом материала по ней.
interface LocationRow {
  key: string;
  zoneNames: string[];
  floorsLabel: string;
  typeLabels: string[];
  workNames: string[];
  quantity: number;
  total: number;
}

const qty = (n: number) => Math.round(n * 1e4) / 1e4;

// Свернуть вхождения материала по локации работы. Ключ — на работу целиком (у работы один
// locations[]), поэтому каждое вхождение попадает ровно в одну группу — двойного счёта нет.
function buildRows(occurrences: MaterialOccurrence[], zoneIndex: ZoneIndex): LocationRow[] {
  const byKey = new Map<string, LocationRow & { workIds: Set<string> }>();
  for (const occ of occurrences) {
    const key = locationKey(occ.location);
    let row = byKey.get(key);
    if (!row) {
      const { zoneNames, floorsLabel, typeLabel } = locationParts(occ.location, zoneIndex);
      row = {
        key,
        zoneNames,
        floorsLabel,
        typeLabels: typeLabel ? [typeLabel] : [],
        workNames: [],
        quantity: 0,
        total: 0,
        workIds: new Set(),
      };
      byKey.set(key, row);
    }
    row.quantity += occ.quantity;
    row.total += occ.total;
    // Работы считаем уникально: у материала может быть несколько строк в одной работе.
    if (!row.workIds.has(occ.workId)) {
      row.workIds.add(occ.workId);
      row.workNames.push(occ.workName);
    }
  }
  return [...byKey.values()].sort((a, b) => b.quantity - a.quantity);
}

// Разбивка сводной строки материала по местоположениям и типам работ-источников.
export function MaterialLocationsModal({ material, zoneIndex, onClose }: Props) {
  const rows = useMemo(() => buildRows(material.occurrences, zoneIndex), [material.occurrences, zoneIndex]);

  const columns: ColumnsType<LocationRow> = [
    {
      title: 'Местоположение',
      key: 'location',
      render: (_, r) => (
        <LocationBadgesRow zoneNames={r.zoneNames} floorsLabel={r.floorsLabel} typeLabels={r.typeLabels} />
      ),
    },
    {
      title: 'Работ',
      key: 'works',
      width: 80,
      align: 'center',
      render: (_, r) => (
        <Tooltip title={r.workNames.join(' · ')}>
          <span>{r.workNames.length}</span>
        </Tooltip>
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
    <Modal open title={material.name} width={modalWidth(760)} footer={null} onCancel={onClose}>
      <Table<LocationRow>
        rowKey="key"
        size="small"
        pagination={false}
        dataSource={rows}
        columns={columns}
        scroll={{ x: 640 }}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0}>
              <strong>Итого</strong>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={1} align="center" />
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
