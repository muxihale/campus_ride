import { config } from "dotenv"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../src/generated/prisma/client.js"
import { seedRouteReferences } from "../src/demo/seed-routes.js"
import { seedDemoAccounts } from "../src/demo/seed-accounts.js"

config({ path: [".env", "../../.env"], quiet: true })
const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error("Для seed требуется DATABASE_URL")
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
try {
  const accounts = await seedDemoAccounts(prisma)
  const references = await seedRouteReferences(prisma)
  console.log(
    `Справочники подготовлены: районов ${references.districts}, корпусов ${references.campuses}, точек ${references.locations}`
  )
  console.log("Демо-аккаунты подготовлены; существующие аккаунты сохранены:")
  for (const account of accounts)
    console.log(
      `${account.email}: ${account.roles.map(({ role }) => role).join(", ")}`
    )
} finally {
  await prisma.$disconnect()
}
