import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// TanStack Start in SPA mode: no SSR runtime, prerenders a static shell + client
// bundle that the all-in-one API serves from ./public. In dev, /api is proxied
// to the local API server for same-origin behavior.
export default defineConfig({
	server: {
		port: 5173,
		proxy: {
			"/api": {
				target: process.env.VITE_API_TARGET || "http://localhost:3001",
				changeOrigin: true,
			},
		},
	},
	// Pin IPv4 loopback for the build-time prerender: TanStack Start's prerender spins
	// up the Vite preview server and fetches its own URL. Under Bun in a container,
	// binding and fetching the bare name "localhost" can resolve to mismatched IPv4/IPv6
	// families, causing ConnectionRefused. Forcing 127.0.0.1 aligns bind + fetch + URL.
	preview: {
		host: "127.0.0.1",
	},
	plugins: [
		tanstackStart({ spa: { enabled: true, prerender: { outputPath: "/index" } } }), // ponytail: SPA — dist/server is dead artifact, cleaned by build script (API serves only dist/client)
		// react's plugin must come after start's plugin
		react(),
		tailwindcss(),
	],
});
