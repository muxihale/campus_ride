import "reflect-metadata"
import { randomUUID } from "node:crypto"
import { type INestApplication } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { Test } from "@nestjs/testing"
import { hash, verify } from "@node-rs/argon2"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AppModule } from "../src/app.module.js"
import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  seedDemoAccounts,
} from "../src/demo/seed-accounts.js"
import { PrismaService } from "../src/prisma/prisma.service.js"
import { configureApp } from "../src/setup.js"

describe("Повторяемый seed демо-аккаунтов", () => {
  let app: INestApplication
  let prisma: PrismaService
  const domain = `${randomUUID()}.campusride.test`
  const accounts = DEMO_ACCOUNTS.map((account) => ({
    ...account,
    email: account.email.replace("campusride.test", domain),
  }))
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = module.createNestApplication()
    app.get(ConfigService).set("WEB_ORIGIN", "http://localhost:5173")
    configureApp(app)
    prisma = app.get(PrismaService)
    await app.init()
  })
  afterAll(async () => {
    try {
      if (prisma)
        await prisma.user.deleteMany({
          where: { email: { endsWith: `@${domain}` } },
        })
    } finally {
      if (app) await app.close()
    }
  })

  it("создаёт три аккаунта с Argon2id и позволяет каждому войти и восстановить сессию", async () => {
    await seedDemoAccounts(prisma, accounts)
    for (const account of accounts) {
      const stored = await prisma.user.findUniqueOrThrow({
        where: { email: account.email },
      })
      expect(stored.passwordHash).toMatch(/^\$argon2id\$/)
      expect(await verify(stored.passwordHash, DEMO_PASSWORD)).toBe(true)
      const response = await request(app.getHttpServer())
        .post("/api/auth/login")
        .set("Origin", "http://localhost:5173")
        .send({ email: account.email, password: DEMO_PASSWORD })
        .expect(200)
      expect(
        [...response.body.roles].sort((a: string, b: string) =>
          a.localeCompare(b)
        )
      ).toEqual(
        [...account.roles].sort((a: string, b: string) => a.localeCompare(b))
      )
      const cookie = (
        response.headers["set-cookie"] as unknown as string[]
      )[0]!.split(";")[0]!
      await request(app.getHttpServer())
        .get("/api/auth/me")
        .set("Cookie", cookie)
        .expect(200, response.body)
    }
  })

  it("повторный запуск сохраняет изменённые профиль, пароль, статус, роли и сессии", async () => {
    const changed = await prisma.user.update({
      where: { email: accounts[2]!.email },
      data: {
        fullName: "Новое имя",
        affiliation: "Другая принадлежность",
        passwordHash: await hash("Changed-password-2026"),
        status: "BLOCKED",
        roles: { deleteMany: {}, create: { role: "PASSENGER" } },
      },
    })
    const before = await prisma.user.findMany({
      where: { email: { endsWith: `@${domain}` } },
      include: { roles: true, sessions: true },
      orderBy: { email: "asc" },
    })
    await seedDemoAccounts(prisma, accounts)
    const after = await prisma.user.findMany({
      where: { email: { endsWith: `@${domain}` } },
      include: { roles: true, sessions: true },
      orderBy: { email: "asc" },
    })
    expect(after).toEqual(before)
    expect(after).toHaveLength(3)
    expect(
      after.find(({ id }) => id === changed.id)!.roles.map(({ role }) => role)
    ).toEqual(["PASSENGER"])
  })
})
