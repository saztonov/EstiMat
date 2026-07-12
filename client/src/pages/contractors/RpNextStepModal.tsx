import { useState } from 'react';
import { Modal, Button, Space, Typography, App } from 'antd';
import { FileExcelOutlined, FileDoneOutlined } from '@ant-design/icons';
import { api } from '../../services/api';
import { modalWidth } from '../../lib/modalWidth';
import { RpFormModal } from '../requests/RpFormModal';

const { Text } = Typography;

interface Props {
  open: boolean;
  requestId: string;
  requestNumber: string;
  onClose: () => void;
}

/**
 * Развилка после создания заявки «Оплата по РП»: выгрузить материалы в Excel, оформить РП
 * или просто закрыть. Оформление РП открывает форму заявки на оплату.
 */
export function RpNextStepModal({ open, requestId, requestNumber, onClose }: Props) {
  const { message } = App.useApp();
  const [rpFormOpen, setRpFormOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  async function exportExcel() {
    setDownloading(true);
    try {
      await api.download(`/requests/${requestId}/export`, {}, `Заявка_${requestNumber}.xlsx`);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <Modal
        title={`Заявка ${requestNumber} создана`}
        open={open && !rpFormOpen}
        onCancel={onClose}
        footer={<Button onClick={onClose}>ОК</Button>}
        width={modalWidth(460)}
      >
        <Text type="secondary">Выберите следующее действие по заявке:</Text>
        <Space direction="vertical" style={{ width: '100%', marginTop: 16 }} size="middle">
          <Button block icon={<FileExcelOutlined />} loading={downloading} onClick={exportExcel}>
            Экспорт материалов в Excel
          </Button>
          <Button block type="primary" icon={<FileDoneOutlined />} onClick={() => setRpFormOpen(true)}>
            Оформить РП
          </Button>
        </Space>
      </Modal>

      <RpFormModal
        open={rpFormOpen}
        requestId={requestId}
        requestNumber={requestNumber}
        onClose={() => setRpFormOpen(false)}
        onDone={onClose}
      />
    </>
  );
}
