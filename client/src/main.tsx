import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppProviders } from './AppProviders';
import { ApiError } from './services/api';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Не ретраить то, что ретраем «не лечится»: таймаут/обрыв/сеть (ApiError.status === 0),
      // клиентские 4xx и 429. Иначе тяжёлый запрос по 20с-таймауту ретраился и давал ~40с
      // ожидания. Один ретрай — только для 5xx (502/503/504) и неизвестных ошибок.
      retry: (failureCount, error) => {
        if (error instanceof ApiError) return error.status >= 500 && failureCount < 1;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppProviders />
    </QueryClientProvider>
  </React.StrictMode>,
);
