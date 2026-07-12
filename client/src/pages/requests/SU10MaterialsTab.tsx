import { useMemo, useState } from 'react';
import { Select, Segmented, Table, Button, Space, Empty, Tag } from 'antd';
import { ShoppingCartOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import { round4 } from './requestConstants';
import { SupplierLotFormModal } from './SupplierLotFormModal';
import type { Su10MaterialRow } from './types';

const EPS = 1e-6;

interface ProjectOpt { id: string; code: string | null; name: string }

/** Вкладка «Материалы» (снабжение): свод материалов su10-заявок по объекту → формирование лотов. */
export function SU10MaterialsTab() {
  const [projectId, setProjectId] = useState<string | undefined>();
  const [contractorId, setContractorId] = useState<string | undefined>();
  const [grouped, setGrouped] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);

  const projectsQ = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ data: ProjectOpt[] }>('/projects'),
  });

  const materialsQ = useQuery({
    queryKey: ['su10-materials', projectId, contractorId ?? ''],
    queryFn: () => {
      const p = new URLSearchParams({ projectId: projectId! });
      if (contractorId) p.set('contractorId', contractorId);
      return api.get<{ data: Su10MaterialRow[] }>(`/supplier-orders/materials?${p.toString()}`);
    },
    enabled: !!projectId,
  });

  const rows = materialsQ.data?.data ?? [];

  // Опции фильтра по подрядчику — из данных свода.
  const contractorOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (r.contractor_id) m.set(r.contractor_id, r.contractor_name ?? '—');
    return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }, [rows]);

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.request_item_id)), [rows, selected]);

  function rowSelectionFor(groupRows: Su10MaterialRow[]) {
    const selectable = groupRows.filter((r) => r.remaining > EPS);
    return {
      selectedRowKeys: selectable.filter((r) => selected.has(r.request_item_id)).map((r) => r.request_item_id),
      onChange: (keys: React.Key[]) => {
        setSelected((prev) => {
          const next = new Set(prev);
          for (const r of groupRows) next.delete(r.request_item_id); // сброс выбора этой группы
          for (const k of keys) next.add(String(k));
          return next;
        });
      },
      getCheckboxProps: (r: Su10MaterialRow) => ({ disabled: r.remaining <= EPS }),
    };
  }

  const columns: ColumnsType<Su10MaterialRow> = [
    {
      title: 'Материал', dataIndex: 'material_name', key: 'name',
      render: (v: string, r) => (
        <Space size={4}>
          {v}
          {r.remaining <= EPS && <Tag color="default">в лотах</Tag>}
        </Space>
      ),
    },
    { title: 'Ед.', dataIndex: 'unit', key: 'unit', width: 70 },
    ...(grouped ? [] : [{ title: 'Категория', dataIndex: 'category_name', key: 'cat', render: (v: string | null) => v ?? '—' } as const]),
    { title: 'Вид работ', dataIndex: 'cost_type_name', key: 'ct', render: (v: string | null) => v ?? '—' },
    { title: 'Подрядчик', dataIndex: 'contractor_name', key: 'contractor', width: 170, render: (v: string | null) => v ?? '—' },
    { title: 'Заявка', dataIndex: 'request_no', key: 'req', width: 90, render: (v: number | null) => (v ? `№ ${v}` : '—') },
    { title: 'Запрошено', dataIndex: 'requested', key: 'requested', width: 100, align: 'right', render: (v) => round4(v) },
    { title: 'Заказано', dataIndex: 'ordered', key: 'ordered', width: 100, align: 'right', render: (v) => (Number(v) > 0 ? round4(v) : <span style={{ color: '#bfbfbf' }}>—</span>) },
    {
      title: 'Осталось', dataIndex: 'remaining', key: 'remaining', width: 100, align: 'right',
      render: (v: number) => <strong style={{ color: v > EPS ? '#1677ff' : '#bfbfbf' }}>{round4(v)}</strong>,
    },
  ];

  // Группировка по категории работ (только визуальная).
  const groups = useMemo(() => {
    if (!grouped) return [];
    const m = new Map<string, { name: string; rows: Su10MaterialRow[] }>();
    for (const r of rows) {
      const key = r.category_id ?? '__none__';
      if (!m.has(key)) m.set(key, { name: r.category_name ?? 'Без категории', rows: [] });
      m.get(key)!.rows.push(r);
    }
    return [...m.values()];
  }, [rows, grouped]);

  function selectAllInGroup(groupRows: Su10MaterialRow[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of groupRows) if (r.remaining > EPS) next.add(r.request_item_id);
      return next;
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div style={{ flexShrink: 0, marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Select
          showSearch
          placeholder="Объект (обязателен)"
          style={{ width: 320 }}
          value={projectId}
          onChange={(v) => { setProjectId(v); setSelected(new Set()); }}
          loading={projectsQ.isLoading}
          optionFilterProp="label"
          options={(projectsQ.data?.data ?? []).map((p) => ({ value: p.id, label: `${p.code ? `${p.code} · ` : ''}${p.name}` }))}
        />
        <Select
          allowClear
          showSearch
          placeholder="Все подрядчики"
          style={{ width: 240 }}
          value={contractorId}
          onChange={(v) => setContractorId(v)}
          options={contractorOptions}
          optionFilterProp="label"
          disabled={!projectId}
        />
        <Segmented
          value={grouped ? 'cat' : 'flat'}
          onChange={(v) => setGrouped(v === 'cat')}
          options={[{ value: 'cat', label: 'По категориям' }, { value: 'flat', label: 'Списком' }]}
        />
        <div style={{ flex: 1 }} />
        <Button
          type="primary"
          icon={<ShoppingCartOutlined />}
          disabled={selected.size === 0}
          onClick={() => setModalOpen(true)}
        >
          Заказ поставщику{selected.size > 0 ? ` (${selected.size})` : ''}
        </Button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {!projectId ? (
          <Empty description="Выберите объект — появится список материалов" />
        ) : rows.length === 0 ? (
          <Empty description="Материалов по заявкам СУ-10 нет" />
        ) : grouped ? (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            {groups.map((g, i) => (
              <div key={i}>
                <Space style={{ marginBottom: 8 }}>
                  <strong>{g.name}</strong>
                  <Button size="small" onClick={() => selectAllInGroup(g.rows)}>Выбрать всё</Button>
                </Space>
                <Table<Su10MaterialRow>
                  rowKey="request_item_id"
                  size="small"
                  pagination={false}
                  dataSource={g.rows}
                  columns={columns}
                  rowSelection={{ type: 'checkbox', ...rowSelectionFor(g.rows) }}
                  scroll={{ x: 1000 }}
                />
              </div>
            ))}
          </Space>
        ) : (
          <Table<Su10MaterialRow>
            rowKey="request_item_id"
            size="small"
            loading={materialsQ.isLoading}
            pagination={false}
            dataSource={rows}
            columns={columns}
            rowSelection={{ type: 'checkbox', ...rowSelectionFor(rows) }}
            scroll={{ x: 1100 }}
          />
        )}
      </div>

      {modalOpen && projectId && (
        <SupplierLotFormModal
          open
          projectId={projectId}
          rows={selectedRows}
          onClose={() => setModalOpen(false)}
          onDone={() => { setModalOpen(false); setSelected(new Set()); materialsQ.refetch(); }}
        />
      )}
    </div>
  );
}
