/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Default backend base URL; the user can override it on /settings. */
  readonly VITE_API_BASE?: string
  /** Google Identity Services web client id. Empty hides the Google button. */
  readonly VITE_GOOGLE_CLIENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
