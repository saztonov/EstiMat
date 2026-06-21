/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Абсолютный origin backend API при раздельных доменах (напр. https://api.estimat.example).
  // Пусто/не задано в dev — клиент ходит на относительный /api через прокси Vite.
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Идентификатор сборки, вшитый Vite define; сравнивается с /version.json в рантайме.
declare const __BUILD_ID__: string;
