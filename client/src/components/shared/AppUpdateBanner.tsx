import { type FC, useState } from 'react';
import { Button } from 'antd';
import { useVersionCheck } from '../../hooks/useVersionCheck';

// Глобальный баннер «доступна новая версия». Показывается, когда вкладка
// работает на устаревшем бандле. «Позже» скрывает локально (до перезагрузки/
// ремонта), при следующем расхождении версий баннер появится снова.
export const AppUpdateBanner: FC = () => {
  const { updateAvailable } = useVersionCheck();
  const [dismissed, setDismissed] = useState(false);
  if (!updateAvailable || dismissed) return null;

  return (
    <div className="app-update-banner" role="status">
      <span className="app-update-banner__text">Доступна новая версия приложения</span>
      <div className="app-update-banner__actions">
        <Button type="primary" onClick={() => window.location.reload()}>
          Обновить
        </Button>
        <Button onClick={() => setDismissed(true)}>Позже</Button>
      </div>
    </div>
  );
};
