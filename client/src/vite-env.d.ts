/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Абсолютный origin backend API при раздельных доменах (напр. https://api.estimat.example).
  // Пусто/не задано в dev — клиент ходит на относительный /api через прокси Vite.
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
