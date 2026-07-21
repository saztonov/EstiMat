import { useState } from 'react';
import { Select, Button, Space, Upload, App } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { api } from '../../../services/api';

/**
 * Приложить документ поставщика (КП или счёт) к его предложению. Тип выбирается тут же: сервер
 * ставит по нему response_status='received', а победителем можно выбрать только поставщика
 * с приложенным документом.
 */
export function OfferUpload({ orderId, offerId, onDone }: { orderId: string; offerId: string; onDone: () => void }) {
  const { message } = App.useApp();
  const [docType, setDocType] = useState<'quote' | 'invoice'>('quote');
  return (
    <Space size={2}>
      <Select size="small" value={docType} onChange={setDocType} style={{ width: 88 }}
        options={[{ value: 'quote', label: 'КП' }, { value: 'invoice', label: 'Счёт' }]} />
      <Upload
        showUploadList={false} maxCount={1}
        beforeUpload={(file) => {
          const fd = new FormData();
          fd.append('file', file);
          api.upload(`/supplier-orders/${orderId}/offers/${offerId}/file?documentType=${docType}`, fd)
            .then(() => { message.success('Документ приложен'); onDone(); })
            .catch((e) => message.error((e as Error).message));
          return Upload.LIST_IGNORE;
        }}
      >
        <Button size="small" icon={<UploadOutlined />} />
      </Upload>
    </Space>
  );
}
