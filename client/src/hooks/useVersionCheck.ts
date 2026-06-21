import { useEffect, useState } from 'react';

const POLL_INTERVAL_MS = 10 * 60_000;

// Сравнивает buildId из /version.json (свежий, кладётся при каждой сборке)
// с вшитым в бандл __BUILD_ID__. Расхождение = вкладка работает на старом коде.
// Проверка: на mount, при возврате видимости/фокуса вкладки и раз в ~10 минут.
export const useVersionCheck = (): { updateAvailable: boolean } => {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (import.meta.env.DEV) return; // в dev version.json не эмитится

    let cancelled = false;
    let timer = 0;

    const check = async (): Promise<void> => {
      if (cancelled || updateAvailable) return;
      try {
        const res = await fetch(`/version.json?ts=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data: { buildId?: string } = await res.json();
        if (!cancelled && data.buildId && data.buildId !== __BUILD_ID__) {
          setUpdateAvailable(true);
          window.clearInterval(timer);
        }
      } catch {
        // offline / 404 / невалидный JSON — игнорируем
      }
    };

    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void check();
    };

    void check();
    timer = window.setInterval(() => void check(), POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [updateAvailable]);

  return { updateAvailable };
};
