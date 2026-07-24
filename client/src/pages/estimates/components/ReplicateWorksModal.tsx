import { useMemo, useState } from 'react';
import { Modal, Select, AutoComplete, InputNumber, Switch, Radio, Space, Typography, Alert, Divider } from 'antd';
import { FLOOR_MIN, FLOOR_MAX } from '@estimat/shared';
import { NumberInput } from '../../../components/NumberInput';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';
import { type ZoneNode, flattenZones, ZONE_KIND_LABEL } from './location';
import type { EstimateItem } from './types';

// Целевые параметры тиражирования (тело replicate-items, без sourceItemIds).
export interface ReplicateTargets {
  zoneIds: string[];
  roomTypeIds: string[];
  floorFrom?: number | null;
  floorTo?: number | null;
  locationTypeName?: string | null;
  includeMaterials: boolean;
  skipExisting: boolean;
}

interface Props {
  open: boolean;
  sourceWorks: EstimateItem[];
  zones: ZoneNode[];
  /** Объект сметы — для автодополнения произвольных «типов». */
  projectId: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: (targets: ReplicateTargets) => void;
}

// Модалка «Копировать работы»: размножение выбранных работ на целевые корпуса/зоны и/или тип.
// Тип — самостоятельная целевая координата (проставляется всем копиям; пусто = тип источника).
// Типы помещений временно скрыты (roomTypeIds всегда пуст).
export function ReplicateWorksModal({ open, sourceWorks, zones, projectId, loading, onCancel, onConfirm }: Props) {
  const [zoneIds, setZoneIds] = useState<string[]>([]);
  const [floorMode, setFloorMode] = useState<'source' | 'override'>('source');
  const [floorFrom, setFloorFrom] = useState<number | null>(null);
  const [floorTo, setFloorTo] = useState<number | null>(null);
  const [typeName, setTypeName] = useState<string>('');
  const [includeMaterials, setIncludeMaterials] = useState(true);
  const [skipExisting, setSkipExisting] = useState(true);

  const zoneOptions = useMemo(
    () => flattenZones(zones).map((z) => ({
      value: z.id,
      label: z.kind === 'building' ? z.name : `${z.name} (${ZONE_KIND_LABEL[z.kind]})`,
    })),
    [zones],
  );

  // Типы объекта для автодополнения (грузим при открытии модалки).
  const { data: typeData } = useQuery({
    queryKey: ['project-location-types', projectId],
    queryFn: () => api.get<{ data: { id: string; name: string }[] }>(`/projects/${projectId}/location-types`),
    enabled: open && !!projectId,
  });
  const typeOptions = (typeData?.data ?? []).map((t) => ({ value: t.name }));

  // Грубое превью: контуры = max(1,корпуса); строк = работы × контуры (без вычета дублей).
  // Тип не множит контуры — он проставляется всем копиям.
  const contours = Math.max(1, zoneIds.length);
  const estimatedRows = sourceWorks.length * contours;
  const noTarget = zoneIds.length === 0 && floorMode === 'source' && !typeName.trim();

  const reset = () => {
    setZoneIds([]);
    setFloorMode('source');
    setFloorFrom(null);
    setFloorTo(null);
    setTypeName('');
    setIncludeMaterials(true);
    setSkipExisting(true);
  };

  const handleConfirm = () => {
    onConfirm({
      zoneIds,
      roomTypeIds: [],
      floorFrom: floorMode === 'override' ? floorFrom : undefined,
      floorTo: floorMode === 'override' ? floorTo : undefined,
      locationTypeName: typeName.trim() || undefined,
      includeMaterials,
      skipExisting,
    });
  };

  return (
    <Modal
      title="Копировать работы"
      open={open}
      onCancel={() => { reset(); onCancel(); }}
      onOk={handleConfirm}
      okText="Скопировать"
      okButtonProps={{ disabled: noTarget || sourceWorks.length === 0, loading }}
      afterClose={reset}
      width={560}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        Выбрано работ: <b>{sourceWorks.length}</b>. Будут созданы копии на каждый целевой корпус/зону.
        Корпуса, этажи и тип берутся из источника, если не заданы явно.
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
              <NumberInput preset="integer" min={FLOOR_MIN} max={FLOOR_MAX} placeholder="этаж от" value={floorFrom ?? undefined} onChange={(v) => setFloorFrom(v as number | null)} />
              <NumberInput preset="integer" min={FLOOR_MIN} max={FLOOR_MAX} placeholder="до" value={floorTo ?? undefined} onChange={(v) => setFloorTo(v as number | null)} />
            </Space>
          )}
        </div>

        <div>
          <Typography.Text strong>Тип</Typography.Text>
          <AutoComplete
            allowClear
            style={{ width: '100%', marginTop: 4 }}
            placeholder="Как у источника (или выберите/введите тип)"
            value={typeName}
            options={typeOptions}
            filterOption={(input, option) => (option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
            onChange={(v) => setTypeName(v ?? '')}
          />
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
          <Alert type="warning" showIcon message="Выберите целевую зону, задайте этажи или укажите тип." />
        ) : (
          <Alert
            type="info"
            showIcon
            message={`Будет создано до ${estimatedRows} строк (${sourceWorks.length} работ × ${contours} контур(ов))${typeName.trim() ? `; тип «${typeName.trim()}» проставится всем копиям` : ''}${skipExisting ? '; дубли по местоположению пропускаются' : ''}.`}
          />
        )}
      </Space>
    </Modal>
  );
}
