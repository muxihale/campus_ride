import { config } from "dotenv"
import { defineConfig } from "prisma/config"

config({ path: [".env", "../../.env"], quiet: true })

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "bun prisma/seed.ts" },
  datasource: {
    // Локальное значение позволяет генерировать клиент без работающей БД.
    url:
      process.env.DATABASE_URL ??
      "postgresql://campusride:campusride_local@localhost:5432/campusride?schema=public",
  },
})
