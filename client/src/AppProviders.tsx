/**
 * Провайдеры оформления: алгоритм темы Ant Design и атрибут data-theme для собственных
 * стилей (переменные --est-* в index.css). Вынесено из main.tsx отдельным компонентом,
 * потому что режим читается хуком стора.
 */
import { useLayoutEffect } from 'react';
import { BrowserRouter } from 'react-router';
import { ConfigProvider, App as AntApp, theme as antdTheme } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import App from './App';
import { useThemeStore } from './store/themeStore';

export function AppProviders() {
  const mode = useThemeStore((s) => s.mode);
  const isDark = mode === 'dark';

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = mode;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', isDark ? '#141414' : '#ffffff');
  }, [mode, isDark]);

  return (
    <ConfigProvider
      locale={ruRU}
      theme={{ algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm }}
    >
      <AntApp>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  );
}
