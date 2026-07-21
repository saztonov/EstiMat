import { useState } from 'react';
import { Button, Tooltip } from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import { VersionHistoryDrawer } from './VersionHistoryDrawer';

/**
 * Кнопка «История версий» со своим дровером: что изменилось в приложении от версии к версии
 * (client/src/changelog.ts). Состояние держит сама — точке вставки достаточно поставить
 * компонент в тулбар или в extra карточки. Стоит в разделах «Сметы» и «Заявки».
 */
export function VersionHistoryButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip title="История версий">
        <Button
          type="text"
          icon={<HistoryOutlined />}
          aria-label="История версий"
          onClick={() => setOpen(true)}
        />
      </Tooltip>
      <VersionHistoryDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
