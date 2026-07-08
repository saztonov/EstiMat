import { useState } from 'react';
import { useNavigate } from 'react-router';
import { App, Button, Modal, Tooltip } from 'antd';
import { ContainerOutlined } from '@ant-design/icons';
import { LocationBuilder } from '../../projects/LocationBuilder';
import { BuildingsIcon } from '../../../components/shared/BuildingsIcon';

interface Props {
  estimateId: string;
  projectId: string;
  /** Телефонный режим: кнопки без текста, только иконки. */
  compact?: boolean;
}

// Кнопки «Материалы» и «Местоположение» для шапки панели «Сметная часть».
// Модалка местоположения с подтверждением закрытия при несохранённых изменениях.
export function SmetaActions({ estimateId, projectId, compact }: Props) {
  const { modal } = App.useApp();
  const navigate = useNavigate();
  const [zonesOpen, setZonesOpen] = useState(false);
  const [zonesDirty, setZonesDirty] = useState(false);

  const closeZones = () => {
    if (zonesDirty) {
      modal.confirm({
        title: 'Закрыть без сохранения?',
        content: 'Есть несохранённые изменения местоположения.',
        okText: 'Закрыть',
        cancelText: 'Остаться',
        onOk: () => { setZonesDirty(false); setZonesOpen(false); },
      });
    } else {
      setZonesOpen(false);
    }
  };

  return (
    <>
      <Tooltip title="Свод материалов сметы">
        <Button size="small" icon={<ContainerOutlined />} aria-label="Материалы" onClick={() => navigate(`/estimates/${estimateId}/materials`)}>
          {compact ? null : 'Материалы'}
        </Button>
      </Tooltip>
      <Tooltip title="Местоположение: корпуса, этажность, типы помещений">
        <Button size="small" icon={<BuildingsIcon />} aria-label="Местоположение" onClick={() => { setZonesDirty(false); setZonesOpen(true); }}>
          {compact ? null : 'Местоположение'}
        </Button>
      </Tooltip>

      <Modal
        title="Местоположение"
        open={zonesOpen}
        onCancel={closeZones}
        footer={null}
        width="90%"
        style={{ top: 24 }}
        styles={{ body: { height: 'calc(100vh - 180px)', overflow: 'hidden' } }}
      >
        {zonesOpen && (
          <LocationBuilder projectId={projectId} onDirtyChange={setZonesDirty} />
        )}
      </Modal>
    </>
  );
}
