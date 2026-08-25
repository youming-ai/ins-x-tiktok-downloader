/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** Browser Sentry DSN; when unset, error reporting is disabled. */
	readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
