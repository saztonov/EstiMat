import { useMemo, useState } from 'react';
import { Modal, Input, Select, Space, App } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';

export interface SupplierSel { id: string; name: string; inn: string | null }

/** Выбор поставщика из справочника: поиск по названию/ИНН, ИНН подставляется автоматически. */
export function SupplierPicker({ value, onChange }: { value?: SupplierSel; onChange: (s?: SupplierSel) => void }) {
  const [search, setSearch] = useState('');
  const suppliersQ = useQuery({
    queryKey: ['suppliers', search],
    queryFn: () => api.get<{ data: SupplierSel[] }>(`/suppliers?q=${encodeURIComponent(search)}`),
  });
  const options = useMemo(() => {
    const list = suppliersQ.data?.data ?? [];
    const opts = list.map((s) => ({ value: s.id, label: s.inn ? `${s.name} (ИНН ${s.inn})` : s.name, supplier: s }));
    // Текущий выбор может не попасть в выдачу (лимит) — подмешиваем, чтобы не показывать UUID.
    if (value?.id && !opts.some((o) => o.value === value.id)) {
      opts.unshift({ value: value.id, label: value.inn ? `${value.name} (ИНН ${value.inn})` : value.name, supplier: value });
    }
    return opts;
  }, [suppliersQ.data, value]);
  return (
    <Select
      showSearch filterOption={false} onSearch={setSearch} loading={suppliersQ.isLoading}
      value={value?.id} options={options.map((o) => ({ value: o.value, label: o.label }))}
      placeholder="Поиск по названию или ИНН" style={{ width: '100%' }}
      onChange={(val) => onChange(options.find((o) => o.value === val)?.supplier)}
    />
  );
}

/** Модалка добавления поставщика в список предложений (из справочника). */
export function AddSupplierModal({
  open, onClose, onSubmit,
}: {
  open: boolean; onClose: () => void;
  onSubmit: (b: { supplierId: string; supplierName: string; supplierInn?: string }) => void;
}) {
  const { message } = App.useApp();
  const [sel, setSel] = useState<SupplierSel>();
  return (
    <Modal
      open={open} title="Поставщик" onCancel={onClose} destroyOnClose afterClose={() => setSel(undefined)}
      onOk={() => {
        if (!sel) return message.warning('Выберите поставщика из справочника');
        onSubmit({ supplierId: sel.id, supplierName: sel.name, supplierInn: sel.inn ?? undefined });
        setSel(undefined);
      }}
      okText="Добавить"
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <SupplierPicker value={sel} onChange={setSel} />
        <Input placeholder="ИНН" value={sel?.inn ?? ''} disabled />
      </Space>
    </Modal>
  );
}
