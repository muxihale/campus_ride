import { UnauthorizedException } from "@nestjs/common"
import type { Prisma } from "../generated/prisma/client.js"

// Блокировка аккаунта ждёт уже начавшиеся операции; новые после неё не выполняются.
// SHARE совместим с проверками внешних ключей при уведомлениях.
export async function lockActiveUser(tx: Prisma.TransactionClient, id: string) {
  const users = await tx.$queryRaw<
    { status: string }[]
  >`SELECT "status" FROM "User" WHERE "id" = ${id}::uuid FOR SHARE`
  if (users[0]?.status !== "ACTIVE")
    throw new UnauthorizedException("Сессия недействительна или истекла")
}
