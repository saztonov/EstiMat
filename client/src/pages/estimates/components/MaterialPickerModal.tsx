import { useEffect, useState } from 'react';
import { Modal, Table, Tag, App } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../services/api';
import { invalidateEstimateQueries } from '../../../lib/estimateQueries';
import type { EstimateItem } from './types';

// Материал-кандидат из подбора: ранее подтверждённый материал под работами с тем же rate_id.
interface Suggestion {
  material_id: string | null;
  description: string;
  unit: string;
  unit_price: string;
  qty_ratio: string | null;
  use_count: number;
  already_added: boolean;
}

interface Props {
  open: boolean;
  item: EstimateItem | null;
  estimateId: string;
  projectId: string;
  onClose: () => void;
}

// Ключ строки: material_id либо имя+ед. (дедуп на сервере идёт по тому же принципу).
const keyOf = (s: Suggestion) =>
  s.material_id ?? `${s.description.trim().toLowerCase()}|${s.unit.trim().toLowerCase()}`;

// Подбор материалов к работе: показывает ранее использованные (подтверждённые) материалы и
// добавляет выбранные к строке одним запросом. Для ручных работ (rate_id = null) кнопка подбора
// в таблице неактивна, поэтому сюда такие строки не попадают.
export function MaterialPickerModal({ open, item, estimateId, projectId, onClose }: Props) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);

  const itemId = item?.id;
  const { data, isLoading } = useQuery({
    queryKey: ['material-suggestions', itemId],
    queryFn: () => api.get<{ data: Suggestion[] }>(`/estimate-items/${itemId}/material-suggestions`),
    enabled: open && !!itemId,
  });
  const suggestions = data?.data ?? [];

  // При каждом открытии/смене работы — сбрасываем выбор.
  useEffect(() => {
    if (open) setSelectedKeys([]);
  }, [open, itemId]);

  const addMutation = useMutation({
    mutationFn: (materials: Array<Record<string, unknown>>) =>
      api.post<{ count: number }>(`/estimate-items/${itemId}/materials/batch`, { materials }),
    onSuccess: (res) => {
      invalidateEstimateQueries(queryClient, { estimateId, projectId });
      message.success(`Добавлено материалов: ${res.count}`);
      onClose();
    },
    onError: (e: Error) => message.error(e.message),
  });

  function handleAdd() {
    const chosen = suggestions.filter((s) => selectedKeys.includes(keyOf(s)) && !s.already_added);
    if (chosen.length === 0) return;
    // status не передаём — сервер ставит 'confirmed'. Количество считает сервер, если задан qty_ratio.
    const materials = chosen.map((s) => ({
      materialId: s.material_id,
      description: s.description,
      unit: s.unit,
      unitPrice: Number(s.unit_price ?? 0),
      quantity: 1,
      qtyRatio: s.qty_ratio != null ? Number(s.qty_ratio) : null,
    }));
    addMutation.mutate(materials);
  }

  const columns: ColumnsType<Suggestion> = [
    {
      title: 'Наименование',
      dataIndex: 'description',
      render: (v: string, r) => (
        <span>
          {v}
          {r.already_added && (
            <Tag color="default" style={{ marginInlineStart: 8 }}>
              уже в смете
            </Tag>
          )}
        </span>
      ),
    },
    { title: 'Ед.', dataIndex: 'unit', width: 70, align: 'center' },
    {
      title: 'Цена, ₽',
      dataIndex: 'unit_price',
      width: 100,
      align: 'right',
      render: (v: string) => Number(v ?? 0).toLocaleString('ru-RU'),
    },
    {
      title: 'Использований',
      dataIndex: 'use_count',
      width: 120,
      align: 'center',
    },
  ];

  const selectableCount = suggestions.filter((s) => !s.already_added).length;

  return (
    <Modal
      title={item ? `Подбор материалов: ${item.description}` : 'Подбор материалов'}
      open={open}
      onCancel={onClose}
      onOk={handleAdd}
      okText={`Добавить выбранные${selectedKeys.length ? ` (${selectedKeys.length})` : ''}`}
      okButtonProps={{ disabled: selectedKeys.length === 0, loading: addMutation.isPending }}
      cancelText="Отмена"
      width={760}
    >
      <Table<Suggestion>
        rowKey={keyOf}
        size="small"
        loading={isLoading}
        columns={columns}
        dataSource={suggestions}
        pagination={false}
        scroll={{ y: 420 }}
        locale={{
          emptyText: selectableCount === 0 && suggestions.length === 0
            ? 'Для этой работы ещё не использовали материалов'
            : 'Ничего не найдено',
        }}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: setSelectedKeys,
          getCheckboxProps: (r) => ({ disabled: r.already_added }),
        }}
      />
    </Modal>
  );
}
