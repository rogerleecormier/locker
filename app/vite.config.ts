import { defineConfig, type Plugin } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

// kysely 0.29.x moved DEFAULT_MIGRATION_* out of the main barrel into
// kysely/migration, but @better-auth/kysely-adapter@1.6.14 still imports
// them from "kysely". This plugin appends re-exports to patch the gap.
function kyselyMigrationShim(): Plugin {
  return {
    name: "kysely-migration-shim",
    transform(code, id) {
      if (id.includes("node_modules/kysely/dist/index.js")) {
        return (
          code +
          `\nexport { DEFAULT_MIGRATION_TABLE, DEFAULT_MIGRATION_LOCK_TABLE } from './migration/migrator.js';\n`
        );
      }
    },
  };
}

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    kyselyMigrationShim(),
    tailwindcss(),
    tanstackStart(),
    react(),
    cloudflare({
      viteEnvironment: { name: "ssr" },
    }),
  ],
});
