/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH0_DOMAIN?: string;
  readonly VITE_AUTH0_CLIENT_ID?: string;
  readonly VITE_AUTH0_AUDIENCE?: string;
  readonly VITE_AUTH_BYPASS?: string;
  readonly VITE_ADMIN_EMAILS?: string;
  readonly VITE_TTS_PROVIDER?: "browser" | "voice-tools";
  readonly VITE_TTS_BASE_URL?: string;
  readonly VITE_TTS_VOICE?: string;
  readonly VITE_TTS_LM_STUDIO_TARGET?: "workstation" | "headless";
}

interface ImportMeta {
  readonly env: ImportMetaEnv & { readonly DEV: boolean };
}
