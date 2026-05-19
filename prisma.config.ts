import { config } from "dotenv";
// Load .env.local (Next.js convention) with priority, then .env as fallback
config({ path: ".env.local" });
config();

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
