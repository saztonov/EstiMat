import { useEffect, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { refreshSession } from '../services/api';

const REFRESH_CHECK_INTERVAL = 30_000; // 30 seconds
const REFRESH_THRESHOLD = 2 * 60_000;  // 2 minutes before expiry

export function useAuthRefresh() {
  const accessTokenExpiresAt = useAuthStore((s) => s.accessTokenExpiresAt);
  const setExpiresAt = useAuthStore((s) => s.setExpiresAt);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const refreshingRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) return;

    async function tryRefresh() {
      if (refreshingRef.current) return;
      const expiresAt = useAuthStore.getState().accessTokenExpiresAt;
      if (!expiresAt) return;

      const timeLeft = expiresAt - Date.now();
      if (timeLeft > REFRESH_THRESHOLD) return;

      refreshingRef.current = true;
      try {
        // Общий с REST refresh: ходит на ${VITE_API_URL}/api/auth/refresh (а не относительный
        // путь), поэтому работает и при раздельных доменах app.*/api.* в проде.
        const r = await refreshSession();
        if (r.ok) setExpiresAt(r.expiresAt);
      } catch { /* ignore */ }
      refreshingRef.current = false;
    }

    const interval = setInterval(tryRefresh, REFRESH_CHECK_INTERVAL);

    // Also refresh on visibility change (tab regains focus)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tryRefresh();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isAuthenticated, setExpiresAt]);
}
