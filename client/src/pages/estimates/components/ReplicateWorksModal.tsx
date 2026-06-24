import { useMemo, useState } from 'react';
import { Modal, Select, InputNumber, Switch, Radio, Space, Typography, Alert, Divider } from 'antd';
import { type ZoneNode, flattenZones, ZONE_KIND_LABEL } from './location';
import type { EstimateItem } from './types';

// Целевые параметры тиражирования (тело replicate-items, без sourceItemIds).
export interface ReplicateTargets {
  zoneIds: string[];
  roomTypeIds: string[];
  floorFrom?: number | null;
  floorTo?: number | null;
  includeMaterials: boolean;
  skipExisting: boolean;
}

interface Props {
  open: boolean;
  sourceWorks: EstimateItem[];
  zones: ZoneNode[];
  loading?: boolean;
  onCancel: () => void;
  onConfirm: (targets: ReplicateTargets) => void;
}

// Модалка «Повторить набор»: размножение выбранных работ на целевые корпуса/зоны.
// Типы помещений временно скрыты (roomTypeIds всегда пуст).
export function ReplicateWorksModal({ open, sourceWorks, zones, loading, onCancel, onConfirm }: Props) {
  const [zoneIds, setZoneIds] = useState<string[]>([]);
  const [floorMode, setFloorMode] = useState<'source' | 'override'>('source');
  const [floorFrom, setFloorFrom] = useState<number | null>(null);
  const [floorTo, setFloorTo] = useState<number | null>(null);
  const [includeMaterials, setIncludeMaterials] = useState(true);
  const [skipExisting, setSkipExisting] = useState(true);

  const zoneOptions = useMemo(
    () => flattenZones(zones).map((z) => ({
      value: z.id,
      label: z.kind === 'building' ? z.name : `${z.name} (${ZONE_KIND_LABEL[z.kind]})`,
    })),
    [zones],
  );

  // Грубое превью: контуры = max(1,корпуса); строк = работы × контуры (без вычета дублей).
  const contours = Math.max(1, zoneIds.length);
  const estimatedRows = sourceWorks.length * contours;
  const noTarget = zoneIds.length === 0 && floorMode === 'source';

  const reset = () => {
    setZoneIds([]);
    setFloorMode('source');
    setFloorFrom(null);
    setFloorTo(null);
    setIncludeMaterials(true);
    setSkipExisting(true);
  };

  const handleConfirm = () => {
    onConfirm({
      zoneIds,
      roomTypeIds: [],
      floorFrom: floorMode === 'override' ? floorFrom : undefined,
      floorTo: floorMode === 'override' ? floorTo : undefined,
      includeMaterials,
      skipExisting,
    });
  };

  return (
    <Modal
      title="Повторить набор работ"
      open={open}
      onCancel={() => { reset(); onCancel(); }}
      onOk={handleConfirm}
      okText="Повторить"
      okButtonProps={{ disabled: noTarget || sourceWorks.length === 0, loading }}
      afterClose={reset}
      width={560}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        Выбрано работ: <b>{sourceWorks.length}</b>. Будут созданы копии на каждый целевой корпус/зону.
        Диапазон этажей переносится из источника или задаётся вручную.
      </Typography.Paragraph>

      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div>
          <Typography.Text strong>Целевые корпуса/зоны</Typography.Text>
          <Select
            mode="multiple"
            allowClear
            style={{ width: '100%', marginTop: 4 }}
            placeholder="Как у источника (если не выбрано)"
            value={zoneIds}
            onChange={setZoneIds}
            optionFilterProp="label"
            options={zoneOptions}
          />
        </div>

        <div>
          <Typography.Text strong>Этажи</Typography.Text>
          <div style={{ marginTop: 4 }}>
            <Radio.Group value={floorMode} onChange={(e) => setFloorMode(e.target.value)}>
              <Radio value="source">Как у источника</Radio>
              <Radio value="override">Задать диапазон</Radio>
            </Radio.Group>
          </div>
          {floorMode === 'override' && (
            <Space style={{ marginTop: 8 }}>
              <InputNumber placeholder="этаж от" value={floorFrom ?? undefined} onChange={(v) => setFloorFrom(v as number | null)} step={1} />
              <InputNumber placeholder="до" value={floorTo ?? undefined} onChange={(v) => setFloorTo(v as number | null)} step={1} />
            </Space>
          )}
        </div>

        <Space size="large">
          <Space size={6}>
            <Switch checked={includeMaterials} onChange={setIncludeMaterials} />
            <span>Копировать материалы</span>
          </Space>
          <Space size={6}>
            <Switch checked={skipExisting} onChange={setSkipExisting} />
            <span>Пропускать дубли</span>
          </Space>
        </Space>

        <Divider style={{ margin: '4px 0' }} />
        {noTarget ? (
          <Alert type="warning" showIcon message="Выберите хотя бы одну целевую зону или задайте этажи." />
        ) : (
          <Alert
            type="info"
            showIcon
            message={`Будет создано до ${estimatedRows} строк (${sourceWorks.length} работ × ${contours} контур(ов))${skipExisting ? '; дубли по локации пропускаются' : ''}.`}
          />
        )}
      </Space>
    </Modal>
  );
}
