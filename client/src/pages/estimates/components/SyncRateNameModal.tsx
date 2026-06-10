import { useState } from 'react';
import { Modal, Button, Typography, Space, App } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../services/api';

export interface SyncRateNameResolution {
  description: string;
  rateId: string | null;
}

interface Props {
  open: boolean;
  oldName: string;
  newName: string;
  /** Расценка, к которой привязана работа (null — произвольная работа). */
  rateId: string | null;
  /** Вид работ — нужен для создания новой расценки. */
  costTypeId: string | null;
  unit: string;
  unitPrice: number;
  /** null — пользователь закрыл модалку, сохранение отменяется (остаёмся в редактировании). */
  onResolve: (resolution: SyncRateNameResolution | null) => void;
}

// Уточнение при изменении названия работы в смете: синхронизировать ли
// справочник наименований (расценок) — обновить существующее, создать новое
// или оставить название работы прежним.
export function SyncRateNameModal({ open, oldName, newName, rateId, costTypeId, unit, unitPrice, onResolve }: Props) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<'update' | 'create' | null>(null);

  const invalidateRates = () => {
    queryClient.invalidateQueries({ queryKey: ['rates'] });
    queryClient.invalidateQueries({ queryKey: ['rates-tree'] });
  };

  async function updateInCatalog() {
    if (!rateId) return;
    setBusy('update');
    try {
      await api.put(`/rates/${rateId}`, { name: newName });
      invalidateRates();
      onResolve({ description: newName, rateId });
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function createInCatalog() {
    if (!costTypeId) return;
    setBusy('create');
    try {
      const res = await api.post<{ data: { id: string } }>('/rates', {
        costTypeId,
        name: newName,
        unit,
        price: unitPrice,
      });
      invalidateRates();
      onResolve({ description: newName, rateId: res.data.id });
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      title="Название работы изменено"
      open={open}
      onCancel={() => onResolve(null)}
      footer={null}
      width={520}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <div>
          <Typography.Text type="secondary" delete style={{ display: 'block' }}>{oldName}</Typography.Text>
          <Typography.Text strong style={{ display: 'block' }}>{newName}</Typography.Text>
        </div>
        <Typography.Text>Как поступить со справочником наименований работ?</Typography.Text>
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {rateId && (
            <Button block type="primary" loading={busy === 'update'} disabled={busy === 'create'} onClick={updateInCatalog}>
              Обновить наименование в справочнике
            </Button>
          )}
          {costTypeId && (
            <Button block loading={busy === 'create'} disabled={busy === 'update'} onClick={createInCatalog}>
              Создать новое наименование в справочнике
            </Button>
          )}
          <Button block disabled={!!busy} onClick={() => onResolve({ description: oldName, rateId })}>
            Отменить изменение названия
          </Button>
        </Space>
      </Space>
    </Modal>
  );
}
