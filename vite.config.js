import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { getBootstrapData } from "./api/bootstrap.js";

function apiPlugin() {
  return {
    name: "pokedole-api",
    configureServer(server) {
      server.middlewares.use("/api/bootstrap", async (_request, response) => {
        try {
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify(await getBootstrapData()));
        } catch (error) {
          console.error(error);
          response.statusCode = 502;
          response.end(JSON.stringify({ error: "Could not load game data." }));
        }
      });
    },
  };
}

export default defineConfig({ plugins: [react(), apiPlugin()] });
