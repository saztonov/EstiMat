import { useMemo, useState } from 'react';
import { Table, Tag, Space, Empty, Tooltip, Select, Button, InputNumber, Dropdown, App } from 'antd';
import { PlusOutlined, DownOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MATERIAL_REQUEST_TYPES,
  MATERIAL_REQUEST_TYPE_LABELS,
  type MaterialRequestType,
} from '@estimat/shared';
import { api } from '../../services/api';
import { buildMaterialGroups, type AggregatedMaterial } from '../estimates/materials/aggregateMaterials';
import { formatMoney, type EstimateItem } from '../estimates/components/types';
import { formatFloors, type ZoneNode } from '../estimates/components/location';
import { LocationBadgesRow, locationParts, type ZoneIndex } from '../estimates/components/LocationBadges';
import { LocationFilterPopover } from '../estimates/workspace/LocationFilterPopover';
import { useContractorLocationFilter } from './useContractorLocationFilter';
import { MaterialLocationsModal } from './MaterialLocationsModal';
import { RpNextStepModal } from './RpNextStepModal';
import { DeliveryScheduleModal, type ScheduleLineInput, type ScheduledLine } from './DeliveryScheduleModal';

interface Props {
  estimateId: string;
  items: EstimateItem[];
  /** Подрядчик: материалы масштабируются по его доле строки (effective_qty / quantity). */
  viewerIsContractor: boolean;
  zones: ZoneNode[];
  zoneIndex: ZoneIndex;
}

const num = (v: string | number | null | undefined) => Number(v ?? 0);
const EPS = 1e-6;

// Ключ строки заказа/заявки: (вид работ, свёртка материала). agg_key = m.key из свода.
const rowKey = (costTypeId: string | null, aggKey: string) => `${costTypeId ?? ''}|${aggKey}`;

// Для подрядчика — масштабировать материалы строки по его доле объёма (нельзя показывать 100%).
function scaleForContractor(items: EstimateItem[]): EstimateItem[] {
  return items.map((it) => {
    const q = num(it.quantity);
    const eff = num(it.my_effective_qty);
    const share = q > 0 ? eff / q : 1;
    if (share >= 1 - 1e-9) return it;
    return {
      ...it,
      materials: it.materials.map((m) => ({
        ...m,
        quantity: String(num(m.quantity) * share),
        total: String(num(m.total) * share),
      })),
    };
  });
}

export function ContractorsMaterialsTab({ estimateId, items, viewerIsContractor, zones, zoneIndex }: Props) {
  const [filterContractorIds, setFilterContractorIds] = useState<string[]>([]);
  // Разбивка сводной строки по локациям (клик по названию материала).
  const [breakdown, setBreakdown] = useState<AggregatedMaterial | null>(null);
  // Режим заявки на материалы (только подрядчик).
  const [editing, setEditing] = useState(false);
  // Тип заявки выбирается осознанно (без значения по умолчанию).
  const [requestType, setRequestType] = useState<MaterialRequestType | null>(null);
  const [draft, setDraft] = useState<Map<string, number>>(new Map());
  // Развилка после создания заявки «Оплата по РП» (Excel / Оформить РП / ОК).
  const [created, setCreated] = useState<{ id: string; number: string } | null>(null);
  // Окно графика поставки для «Закупка через СУ-10» (открывается перед созданием заявки).
  const [scheduleModal, setScheduleModal] = useState<{ lines: ScheduleLineInput[]; createRequestId: string } | null>(null);
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  // Опции фильтра — только подрядчики, реально назначенные на работы в этой смете
  // (источник — item_contractors, как на вкладке «Смета»).
  const assignedContractorOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of items)
      for (const c of it.item_contractors ?? [])
        if (!map.has(c.contractor_id)) map.set(c.contractor_id, c.contractor_name ?? '—');
    return [...map]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }, [items]);

  // Локационный отбор раздела (корпус/этажи/тип) — своё состояние, не связано со страницей «Смета».
  const {
    value: locFilter,
    onChange: onLocFilterChange,
    clear: clearLocFilter,
    typeOptions: locTypeOptions,
    active: locFilterActive,
    filterItems: filterByLocation,
  } = useContractorLocationFilter(items);

  // Строки, доступные подрядчику по отборам, НЕ зависящим от местоположения.
  const baseItems = useMemo(() => {
    if (!filterContractorIds.length) return items;
    return items.filter((it) =>
      (it.item_contractors ?? []).some((c) => filterContractorIds.includes(c.contractor_id)),
    );
  }, [items, filterContractorIds]);

  // Свод для показа: локационный отбор применяется ДО свёртки, поэтому «По смете» само
  // пересчитывается под выбранный корпус/этаж/тип.
  const groups = useMemo(() => {
    let src = filterByLocation(baseItems);
    if (viewerIsContractor) src = scaleForContractor(src);
    return buildMaterialGroups(src, []);
  }, [baseItems, viewerIsContractor, filterByLocation]);

  // Свод для заявки: полный объём, без локационного отбора. submit() обходит именно его, иначе
  // введённые количества у скрытых отбором строк молча не попали бы в заявку (у заявок нет
  // локационного измерения: ключ — вид работ + свёртка материала).
  const requestGroups = useMemo(() => {
    const src = viewerIsContractor ? scaleForContractor(baseItems) : baseItems;
    return buildMaterialGroups(src, []);
  }, [baseItems, viewerIsContractor]);

  // Заказано ранее: подрядчику — по своей организации; сотруднику — по фильтру/суммарно.
  const orderedQ = useQuery({
    queryKey: ['material-ordered', estimateId, viewerIsContractor ? 'me' : filterContractorIds.join(',')],
    queryFn: () => {
      const params = new URLSearchParams({ estimateId });
      if (!viewerIsContractor && filterContractorIds.length)
        params.set('contractorIds', filterContractorIds.join(','));
      return api.get<{ data: { cost_type_id: string | null; agg_key: string; ordered_qty: string }[] }>(
        `/material-requests/ordered?${params.toString()}`,
      );
    },
    enabled: !!estimateId,
    // Согласуем обновление с материалами подрядчика (contractor-my-items тоже refetchOnWindowFocus):
    // иначе после согласования материалы перейдут на id-ключи, а карта «Заказано» останется из
    // старого кэша и колонка опустеет до ручного обновления.
    refetchOnWindowFocus: true,
  });

  const orderedMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of orderedQ.data?.data ?? []) m.set(rowKey(r.cost_type_id, r.agg_key), num(r.ordered_qty));
    return m;
  }, [orderedQ.data]);

  const submitMutation = useMutation({
    mutationFn: (vars: { requestType: MaterialRequestType; lines: unknown[]; createRequestId: string }) =>
      api.post<{ data: { id: string; number: string } }>('/requests', {
        estimateId,
        requestType: vars.requestType,
        lines: vars.lines,
        createRequestId: vars.createRequestId,
      }),
    onSuccess: (res, vars) => {
      const number = res?.data?.number ?? '';
      setEditing(false);
      setRequestType(null);
      setDraft(new Map());
      setScheduleModal(null);
      queryClient.invalidateQueries({ queryKey: ['material-ordered', estimateId] });
      queryClient.invalidateQueries({ queryKey: ['material-requests', estimateId] });
      queryClient.invalidateQueries({ queryKey: ['requests', 'list'] });
      // Для «Оплата по РП» показываем развилку (Excel / Оформить РП); иначе — просто тост.
      if (vars.requestType === 'own_supplier' && res?.data?.id) {
        setCreated({ id: res.data.id, number });
      } else {
        message.success(number ? `Заявка ${number} создана` : 'Заявка создана');
      }
    },
    onError: (err: Error) => message.error(err.message),
  });

  function updateDraft(key: string, v: number | null) {
    setDraft((prev) => {
      const next = new Map(prev);
      if (v == null || v <= 0) next.delete(key);
      else next.set(key, v);
      return next;
    });
  }

  function cancelEditing() {
    setEditing(false);
    setRequestType(null);
    setDraft(new Map());
  }

  function submit() {
    const lines: {
      costTypeId: string | null;
      aggKey: string;
      materialId: string | null;
      name: string;
      unit: string;
      quantity: number;
    }[] = [];
    // Обходим полный свод, а не отображаемый: черновик живёт по ключу (вид работ + материал)
    // и не должен теряться, если строка скрыта локационным отбором.
    for (const g of requestGroups)
      for (const m of g.materials) {
        const q = draft.get(rowKey(g.costTypeId, m.key));
        if (q && q > 0)
          lines.push({
            costTypeId: g.costTypeId,
            aggKey: m.key,
            materialId: m.materialId,
            name: m.name,
            unit: m.unit,
            quantity: q,
          });
      }
    if (lines.length === 0) {
      message.warning('Укажите количество хотя бы для одного материала');
      return;
    }
    if (!requestType) {
      message.warning('Выберите тип заявки');
      return;
    }
    // «Закупка через СУ-10» — сперва указать график поставки (окно), заявка создаётся после него.
    if (requestType === 'su10') {
      setScheduleModal({ lines, createRequestId: crypto.randomUUID() });
      return;
    }
    submitMutation.mutate({ requestType, lines, createRequestId: crypto.randomUUID() });
  }

  function confirmSchedule(scheduledLines: ScheduledLine[]) {
    if (!scheduleModal) return;
    submitMutation.mutate({
      requestType: 'su10',
      lines: scheduledLines,
      createRequestId: scheduleModal.createRequestId,
    });
  }

  // Колонки строятся на группу (нужен costTypeId группы для ключа заказа/заявки).
  function buildColumns(costTypeId: string | null): ColumnsType<AggregatedMaterial> {
    const cols: ColumnsType<AggregatedMaterial> = [
      {
        title: 'Материал',
        dataIndex: 'name',
        key: 'name',
        render: (_, m) => {
          const key = rowKey(costTypeId, m.key);
          const ordered = orderedMap.get(key) ?? 0;
          const req = draft.get(key) ?? 0;
          const over = viewerIsContractor ? ordered + req > m.quantity + EPS : ordered > m.quantity + EPS;
          return (
            <Space size={4}>
              <Button type="link" style={{ padding: 0, height: 'auto' }} onClick={() => setBreakdown(m)}>
                {m.name}
              </Button>
              {m.hasSuggested && <Tag color="orange">предложение</Tag>}
              {m.hasAi && <Tag color="blue">ИИ</Tag>}
              {/* При активном отборе «По смете» урезано, а «Заказано» — по всей смете:
                  сравнивать их нельзя, иначе тег сработает ложно. */}
              {over && !locFilterActive && <Tag color="red">Сверх сметы</Tag>}
            </Space>
          );
        },
      },
      {
        title: 'Местоположение',
        key: 'location',
        width: 237,
        render: (_, m) => {
          // Союз локаций всех работ-источников: свод сворачивает материал по виду работ.
          // Этажи объединяем числами и форматируем один раз — склейка готовых подписей
          // дала бы «1-4, 2-3» вместо нормализованного набора.
          const zoneNames = new Set<string>();
          const floors: number[] = [];
          const types = new Set<string>();
          for (const occ of m.occurrences) {
            const parts = locationParts(occ.location, zoneIndex);
            for (const z of parts.zoneNames) zoneNames.add(z);
            floors.push(...parts.floors);
            if (parts.typeLabel) types.add(parts.typeLabel);
          }
          return (
            <LocationBadgesRow
              zoneNames={[...zoneNames]}
              floorsLabel={formatFloors(floors)}
              typeLabels={[...types]}
            />
          );
        },
      },
      { title: 'Ед.', dataIndex: 'unit', key: 'unit', width: 70 },
      {
        title: 'По смете',
        dataIndex: 'quantity',
        key: 'quantity',
        width: 110,
        align: 'right',
        render: (v: number) => Math.round(v * 1e4) / 1e4,
      },
      { title: 'Сумма', dataIndex: 'total', key: 'total', width: 140, align: 'right', render: (v: number) => formatMoney(v) },
      {
        title: (
          <Tooltip
            title={
              viewerIsContractor
                ? 'Заказано по всей смете — без учёта отбора по местоположению'
                : 'Заказано по всей смете (с учётом отбора по подрядчикам) — без учёта отбора по местоположению'
            }
          >
            Заказано
          </Tooltip>
        ),
        key: 'ordered',
        width: 100,
        align: 'right',
        render: (_, m) => {
          const v = orderedMap.get(rowKey(costTypeId, m.key)) ?? 0;
          return v > 0 ? Math.round(v * 1e4) / 1e4 : <span style={{ color: '#bfbfbf' }}>—</span>;
        },
      },
    ];

    // Колонка «Заявка» — только в режиме заявки (подрядчик).
    if (editing && viewerIsContractor) {
      cols.push({
        title: 'Заявка',
        key: 'request',
        width: 120,
        align: 'right',
        render: (_, m) => {
          const key = rowKey(costTypeId, m.key);
          return (
            <InputNumber
              min={0}
              style={{ width: 100 }}
              value={draft.get(key)}
              onChange={(v) => updateDraft(key, v as number | null)}
            />
          );
        },
      });
    }

    cols.push({
      title: <Tooltip title="Поставки — следующая итерация">Поставлено</Tooltip>,
      key: 'delivered',
      width: 100,
      align: 'right',
      render: () => <span style={{ color: '#bfbfbf' }}>—</span>,
    });

    return cols;
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0, marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {!viewerIsContractor && (
          <Select
            mode="multiple"
            allowClear
            showSearch
            placeholder="Фильтр по подрядчикам"
            style={{ width: 280 }}
            value={filterContractorIds}
            onChange={setFilterContractorIds}
            options={assignedContractorOptions}
            optionFilterProp="label"
            maxTagCount={1}
          />
        )}
        {/* В режиме заявки отбор заблокирован: количества вводятся от полного объёма
            («Заказано» и «Сверх сметы» считаются по всей смете). */}
        <LocationFilterPopover
          zones={zones}
          typeOptions={locTypeOptions}
          value={locFilter}
          onChange={onLocFilterChange}
          onClear={clearLocFilter}
          showVolumeType={false}
          disabled={editing}
        />
        {viewerIsContractor &&
          (editing ? (
            <>
              {requestType && <Tag color="blue">{MATERIAL_REQUEST_TYPE_LABELS[requestType]}</Tag>}
              <Button type="primary" loading={submitMutation.isPending} onClick={submit}>
                Подтвердить
              </Button>
              <Button onClick={cancelEditing}>Отмена</Button>
            </>
          ) : (
            <Dropdown
              trigger={['click']}
              menu={{
                items: MATERIAL_REQUEST_TYPES.map((t) => ({
                  key: t,
                  label: MATERIAL_REQUEST_TYPE_LABELS[t],
                })),
                onClick: ({ key }) => {
                  setRequestType(key as MaterialRequestType);
                  // Заявка оформляется от полного объёма: локационный отбор снимаем,
                  // иначе «По смете» осталось бы урезанным и вводить было бы не от чего.
                  clearLocFilter();
                  setEditing(true);
                },
              }}
            >
              <Button icon={<PlusOutlined />}>
                Заявка на материалы <DownOutlined />
              </Button>
            </Dropdown>
          ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {groups.length === 0 ? (
          <Empty description="Материалов нет" />
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
          {groups.map((g) => (
            <div key={g.costTypeId ?? '__none__'}>
              <Space style={{ marginBottom: 8 }}>
                <strong>
                  {g.costCategoryName ? `${g.costCategoryName} · ` : ''}
                  {g.costTypeName ?? 'Без вида работ'}
                </strong>
                <span style={{ color: '#1677ff' }}>{formatMoney(g.total)}</span>
              </Space>
              <Table<AggregatedMaterial>
                rowKey="key"
                size="small"
                pagination={false}
                dataSource={g.materials}
                columns={buildColumns(g.costTypeId)}
                scroll={{ x: 1100 }}
              />
            </div>
          ))}
          </Space>
        )}
      </div>
      {breakdown && (
        <MaterialLocationsModal material={breakdown} zoneIndex={zoneIndex} onClose={() => setBreakdown(null)} />
      )}
      {created && (
        <RpNextStepModal
          open
          requestId={created.id}
          requestNumber={created.number}
          onClose={() => setCreated(null)}
        />
      )}
      {scheduleModal && (
        <DeliveryScheduleModal
          open
          lines={scheduleModal.lines}
          loading={submitMutation.isPending}
          onCancel={() => setScheduleModal(null)}
          onConfirm={confirmSchedule}
        />
      )}
    </div>
  );
}
