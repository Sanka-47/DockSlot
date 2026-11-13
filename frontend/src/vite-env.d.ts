/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API base URL, including the `/api` path. Required in production. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
