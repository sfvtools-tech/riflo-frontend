import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  envDir: mode === "smoke" ? false : undefined,
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  plugins: [
    tailwindcss(),
    react(),
    ...(mode === "smoke"
      ? [
          {
            name: "smoke-no-backend",
            configureServer(server: import("vite").ViteDevServer) {
              server.middlewares.use((request, response, next) => {
                if (
                  /^\/(?:v1(?:\/|$)|health(?:\?|$))/.test(request.url ?? "")
                ) {
                  response.writeHead(503, {
                    "Content-Type": "application/json",
                  });
                  response.end(
                    JSON.stringify({
                      error: { code: "smoke_fixture_required" },
                    }),
                  );
                  return;
                }
                next();
              });
            },
          },
        ]
      : []),
  ],
  server: {
    port: 4311,
    strictPort: true,
    proxy:
      mode === "smoke"
        ? undefined
        : {
            "/v1": "http://127.0.0.1:4310",
            "/health": "http://127.0.0.1:4310",
          },
  },
}));
