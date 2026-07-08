import { useCallback, useSyncExternalStore } from 'react';

// Брейкпоинты адаптива. Держать синхронно с media queries в index.css.
/** Мобильный/планшетный режим (< antd xl): workspace без Splitter/ИИ, справочники в Drawer. */
export const MOBILE_MEDIA = '(max-width: 1199.98px)';
/** Телефон (< antd md): сокращённый набор колонок, компактные тулбары. */
export const PHONE_MEDIA = '(max-width: 767.98px)';

/** Реактивное значение CSS media query (корректно с первого рендера, без лишнего кадра). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false, // server snapshot — страховка вне браузера
  );
}

export const useIsMobile = () => useMediaQuery(MOBILE_MEDIA);
export const useIsPhone = () => useMediaQuery(PHONE_MEDIA);
