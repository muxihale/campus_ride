import { hash } from "@node-rs/argon2"
import type { PrismaClient } from "../generated/prisma/client.js"
import type { Role } from "../generated/prisma/enums.js"

export const DEMO_PASSWORD = "CampusRide-demo-2026"
export const DEMO_ACCOUNTS = [
  {
    email: "passenger@campusride.test",
    fullName: "Анна Соколова",
    affiliation: "Студент ИРИТ-РТФ УрФУ",
    roles: ["PASSENGER"],
  },
  {
    email: "driver@campusride.test",
    fullName: "Михаил Кузнецов",
    affiliation: "Сотрудник УрФУ",
    roles: ["PASSENGER", "DRIVER"],
  },
  {
    email: "admin@campusride.test",
    fullName: "Елена Волкова",
    affiliation: "Администратор CampusRide",
    roles: ["ADMIN"],
  },
] satisfies {
  email: string
  fullName: string
  affiliation: string
  roles: Role[]
}[]

// Роли создаются только вместе с новым аккаунтом: существующие записи не меняем.
export async function seedDemoAccounts(
  prisma: PrismaClient,
  accounts = DEMO_ACCOUNTS
) {
  const hashes = await Promise.all(
    accounts.map(() =>
      hash(DEMO_PASSWORD, {
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
        outputLen: 32,
      })
    )
  )
  return prisma.$transaction(async (tx) => {
    const result = []
    for (const [index, account] of accounts.entries()) {
      result.push(
        await tx.user.upsert({
          where: { email: account.email },
          update: {},
          create: {
            email: account.email,
            fullName: account.fullName,
            affiliation: account.affiliation,
            passwordHash: hashes[index]!,
            roles: { create: account.roles.map((role) => ({ role })) },
          },
          select: { email: true, roles: { select: { role: true } } },
        })
      )
    }
    return result
  })
}
