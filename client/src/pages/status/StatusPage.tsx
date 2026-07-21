import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, Result, Button, Typography, Spin } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

const { Text } = Typography;

// Публичная страница статуса доступности сайта (без авторизации).
// Проверяем канонический readiness-эндпоинт API — он одним запросом
// отражает работоспособность и API, и БД: 200 → сайт доступен, 503/сеть → нет.
// Идём обычным fetch (а не обёрткой api) — публичной странице не нужны
// авто-refresh и redirect на /login при 401.
const HEALTH_URL = `${import.meta.env.VITE_API_URL ?? ''}/health/ready`;
const CHECK_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 30_000;

type Status = 'unknown' | 'up' | 'down';

async function probe(): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(HEALTH_URL, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    // Таймаут (мы сами вызвали abort) или сетевая ошибка — сайт недоступен.
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function StatusPage() {
  const [status, setStatus] = useState<Status>('unknown');
  const [checking, setChecking] = useState(true);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  // Помечаем размонтирование, чтобы не обновлять состояние после ухода со страницы.
  const aliveRef = useRef(true);

  // Отдельный флаг checking крутит только кнопку «Обновить» — сам индикатор
  // при фоновом опросе держит последний результат, без мигания.
  const check = useCallback(async () => {
    setChecking(true);
    const ok = await probe();
    if (!aliveRef.current) return;
    setStatus(ok ? 'up' : 'down');
    setLastChecked(new Date());
    setChecking(false);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    check();
    const id = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      aliveRef.current = false;
      clearInterval(id);
    };
  }, [check]);

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: 'var(--est-bg-layout)',
        padding: 16,
      }}
    >
      <Card style={{ width: '100%', maxWidth: 440, textAlign: 'center' }}>
        {status === 'unknown' ? (
          <div style={{ padding: '32px 0' }}>
            <Spin size="large" />
            <div style={{ marginTop: 16 }}>
              <Text type="secondary">Проверка доступности…</Text>
            </div>
          </div>
        ) : (
          <Result
            status={status === 'up' ? 'success' : 'error'}
            title={status === 'up' ? 'Сайт доступен' : 'Сайт недоступен'}
            subTitle={
              lastChecked
                ? `Проверено: ${lastChecked.toLocaleTimeString('ru-RU')}`
                : undefined
            }
            extra={
              <Button icon={<ReloadOutlined />} onClick={check} loading={checking}>
                Обновить
              </Button>
            }
          />
        )}
      </Card>
    </div>
  );
}
