import { useMemo, useState } from 'react';
import { Form, Select, InputNumber, Input, Segmented, Space } from 'antd';
import type { FormInstance } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { SHIPPING_CONDITIONS } from '@estimat/shared';
import { api } from '../../services/api';

interface Supplier {
  id: string;
  name: string;
  inn: string | null;
}

interface Props {
  form: FormInstance;
  /** Текущий поставщик заказа — подмешивается в options, т.к. справочник отдаёт лишь первые записи. */
  currentSupplier?: { id: string; name: string; inn: string | null } | null;
}

/**
 * Общие поля реквизитов заявки «Оплата по РП» (поставщик из справочника, срок поставки, условия
 * отгрузки, сумма счёта). Переиспользуются в форме «Оформить РП» и в правке реквизитов.
 * Документы и комментарий — вне этого компонента (в каждой форме свои).
 */
export function RequisitesFields({ form, currentSupplier }: Props) {
  const [supplierSearch, setSupplierSearch] = useState('');
  const suppliersQ = useQuery({
    queryKey: ['suppliers', supplierSearch],
    queryFn: () => api.get<{ data: Supplier[] }>(`/suppliers?q=${encodeURIComponent(supplierSearch)}`),
  });

  const supplierOptions = useMemo(() => {
    const list = suppliersQ.data?.data ?? [];
    const opts = list.map((s) => ({
      value: s.id,
      label: s.inn ? `${s.name} (ИНН ${s.inn})` : s.name,
      supplier: s,
    }));
    // Текущий поставщик может не попасть в выдачу справочника (лимит) — подмешиваем, чтобы Select
    // не отобразил UUID вместо имени.
    if (currentSupplier?.id && !opts.some((o) => o.value === currentSupplier.id)) {
      opts.unshift({
        value: currentSupplier.id,
        label: currentSupplier.inn ? `${currentSupplier.name} (ИНН ${currentSupplier.inn})` : currentSupplier.name,
        supplier: { id: currentSupplier.id, name: currentSupplier.name, inn: currentSupplier.inn },
      });
    }
    return opts;
  }, [suppliersQ.data, currentSupplier]);

  return (
    <>
      <Form.Item name="supplierId" label="Поставщик" rules={[{ required: true, message: 'Выберите поставщика' }]}>
        <Select
          showSearch
          filterOption={false}
          onSearch={setSupplierSearch}
          loading={suppliersQ.isLoading}
          options={supplierOptions}
          placeholder="Поиск по названию или ИНН"
          onChange={(val) => {
            const s = supplierOptions.find((o) => o.value === val)?.supplier;
            form.setFieldValue('supplierInn', s?.inn ?? '');
          }}
        />
      </Form.Item>
      <Form.Item name="supplierInn" label="ИНН поставщика">
        <Input disabled placeholder="Заполнится из справочника" />
      </Form.Item>
      <Form.Item label="Срок поставки" required style={{ marginBottom: 8 }}>
        <Space align="start">
          <Form.Item name="deliveryDays" rules={[{ required: true, message: 'Укажите срок' }]} noStyle>
            <InputNumber min={1} placeholder="дней" style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="deliveryDaysType" initialValue="working" noStyle>
            <Segmented options={[{ value: 'working', label: 'рабочих' }, { value: 'calendar', label: 'календарных' }]} />
          </Form.Item>
        </Space>
      </Form.Item>
      <Form.Item name="shippingConditions" label="Условия отгрузки" rules={[{ required: true, message: 'Выберите условия отгрузки' }]}>
        <Select
          placeholder="Выберите условия"
          options={SHIPPING_CONDITIONS.map((c) => ({ value: c, label: c }))}
        />
      </Form.Item>
      <Form.Item name="invoiceAmount" label="Сумма счёта, ₽" rules={[{ required: true, message: 'Укажите сумму счёта' }]}>
        <InputNumber min={0.01} precision={2} style={{ width: 220 }} />
      </Form.Item>
    </>
  );
}
