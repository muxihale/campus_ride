import "reflect-metadata"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import type { INestApplication } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { AppModule } from "../src/app.module.js"
import { PrismaService } from "../src/prisma/prisma.service.js"
import { configureApp } from "../src/setup.js"
import type { Role } from "../src/generated/prisma/enums.js"
const domain = `${randomUUID()}.admin-users.campusride.test`
describe("Список пользователей администратора (HTTP + PostgreSQL)", () => {
  let app: INestApplication, prisma: PrismaService
  const accounts: { id: string; cookie: string }[] = []
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = module.createNestApplication()
    configureApp(app)
    prisma = app.get(PrismaService)
    await app.init()
    const roles: Role[][] = [
      ["ADMIN"],
      ["PASSENGER"],
      ["DRIVER"],
      ["PASSENGER", "DRIVER"],
      ["PASSENGER"],
    ]
    for (const [i, userRoles] of roles.entries()) {
      const token = randomBytes(32).toString("base64url")
      const user = await prisma.user.create({
        data: {
          email: `${i}@${domain}`,
          fullName: `${domain} ${i === 4 ? "100%_" : `Анна ${i}`}`,
          passwordHash: "private-password-hash",
          phone: "+79001234567",
          affiliation:
            i === 0 ? null : i === 2 ? "Сотрудник УрФУ" : "Студент ИРИТ-РТФ",
          status: i === 4 ? "BLOCKED" : "ACTIVE",
          createdAt: new Date(`2026-10-${20 + i}T12:00:00Z`),
          roles: { create: userRoles.map((role) => ({ role })) },
          sessions: {
            create: {
              tokenHash: createHash("sha256").update(token).digest("hex"),
              expiresAt: new Date(Date.now() + 3600000),
            },
          },
        },
      })
      accounts.push({ id: user.id, cookie: `campusride_session=${token}` })
    }
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
  const list = (query = "", account = 0) =>
    request(app.getHttpServer())
      .get(`/api/admin/users?${query}`)
      .set("Cookie", accounts[account]!.cookie)
  const scope = `q=${domain}`
  it("выдаёт разрешённые поля, все роли и no-store без секретов и телефона", async () => {
    const result = await list(scope).expect(200)
    expect(result.headers["cache-control"]).toBe("no-store")
    expect(result.body).toMatchObject({ total: 5, page: 1, pageSize: 20 })
    expect(
      result.body.items.find(
        (item: { id: string }) => item.id === accounts[3]!.id
      )
    ).toEqual({
      id: accounts[3]!.id,
      email: `3@${domain}`,
      fullName: `${domain} Анна 3`,
      affiliation: "Студент ИРИТ-РТФ",
      status: "ACTIVE",
      roles: ["PASSENGER", "DRIVER"],
      createdAt: "2026-10-23T12:00:00.000Z",
      updatedAt: expect.any(String),
    })
    expect(JSON.stringify(result.body)).not.toMatch(
      /passwordHash|tokenHash|sessions|phone|private-password-hash|79001234567/
    )
  })
  it("ищет по имени и email без учёта регистра, обрезает пробелы", async () => {
    expect(
      (
        await list(
          `q=${encodeURIComponent(`  2@${domain.toUpperCase()}  `)}`
        ).expect(200)
      ).body.items.map((item: { id: string }) => item.id)
    ).toEqual([accounts[2]!.id])
    expect(
      (await list(`q=${encodeURIComponent(`${domain} анна 1`)}`).expect(200))
        .body.total
    ).toBe(1)
    expect((await list(`q=${randomUUID()}`).expect(200)).body.total).toBe(0)
    expect(
      (await list(`q=${encodeURIComponent(`${domain} 100%_`)}`).expect(200))
        .body.total
    ).toBe(1)
  })
  it("объединяет четыре фильтра через И и не дублирует пользователя с двумя ролями", async () => {
    const query = `${scope}&role=DRIVER&status=ACTIVE&affiliation=${encodeURIComponent("  студент  ")}&registeredFrom=2026-10-23T12:00:00Z&registeredTo=2026-10-23T12:00:00Z`
    const result = await list(query).expect(200)
    expect(result.body.items.map((item: { id: string }) => item.id)).toEqual([
      accounts[3]!.id,
    ])
    expect(result.body.total).toBe(1)
    expect((await list(`${scope}&role=DRIVER`).expect(200)).body.total).toBe(2)
    expect(
      (await list(`${scope}&status=BLOCKED`).expect(200)).body.items[0].id
    ).toBe(accounts[4]!.id)
    expect(
      (await list(`${scope}&affiliation=нет`).expect(200)).body.total
    ).toBe(0)
  })
  it("стабильно сортирует одинаковые даты, разделяет страницы и возвращает пустую страницу", async () => {
    const time = new Date("2026-10-25T12:00:00Z")
    await prisma.user.updateMany({
      where: { id: { in: [accounts[1]!.id, accounts[2]!.id] } },
      data: { createdAt: time, fullName: `${domain} Попутчик` },
    })
    try {
      const ids = [accounts[1]!.id, accounts[2]!.id].sort()
      for (const [index, id] of ids.entries())
        expect(
          (
            await list(
              `${scope}&sort=createdDesc&pageSize=1&page=${index + 1}`
            ).expect(200)
          ).body.items[0].id
        ).toBe(id)
      expect(
        (await list(`${scope}&sort=createdAsc&pageSize=1`).expect(200)).body
          .items[0].id
      ).toBe(accounts[0]!.id)
      expect(
        (
          await list(
            `q=${encodeURIComponent(`${domain} Попутчик`)}&sort=nameAsc`
          ).expect(200)
        ).body.items.map((item: { id: string }) => item.id)
      ).toEqual(ids)
      expect(
        (await list(`${scope}&page=99&pageSize=1`).expect(200)).body
      ).toEqual({ items: [], total: 5, page: 99, pageSize: 1 })
    } finally {
      for (const i of [1, 2])
        await prisma.user.update({
          where: { id: accounts[i]!.id },
          data: {
            createdAt: new Date(`2026-10-${20 + i}T12:00:00Z`),
            fullName: `${domain} Анна ${i}`,
          },
        })
    }
  })
  it("проверяет сессию и роль на сервере", async () => {
    await request(app.getHttpServer()).get("/api/admin/users").expect(401)
    await list(scope, 1).expect(403)
    await list(scope, 2).expect(403)
    await list(scope, 3).expect(403)
    await list(scope, 4).expect(401)
  })
  it("отзывает доступ после удаления роли ADMIN и истечения сессии", async () => {
    const userId = accounts[0]!.id
    await prisma.userRole.delete({
      where: { userId_role: { userId, role: "ADMIN" } },
    })
    try {
      await list(scope).expect(403)
    } finally {
      await prisma.userRole.create({ data: { userId, role: "ADMIN" } })
    }
    await prisma.session.updateMany({
      where: { userId },
      data: { expiresAt: new Date("2000-01-01") },
    })
    try {
      await list(scope).expect(401)
    } finally {
      await prisma.session.updateMany({
        where: { userId },
        data: { expiresAt: new Date(Date.now() + 3600000) },
      })
    }
  })
  it.each([
    "role=ROOT",
    "status=DELETED",
    "page=0",
    "pageSize=101",
    "page=1.5",
    "sort=email",
    "registeredFrom=bad",
    "registeredTo=2026-10-20",
    "registeredFrom=2026-10-24T00:00:00Z&registeredTo=2026-10-20T00:00:00Z",
    "q=" + "а".repeat(101),
    "affiliation=" + "а".repeat(201),
    "passwordHash=x",
    "role=DRIVER&role=ADMIN",
  ])("отклоняет неверные параметры %s", async (query) => {
    await list(query).expect(400)
  })
  it("не раскрывает ошибку БД и не возвращает частичный список", async () => {
    const spy = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(new Error("private database connection"))
    try {
      expect((await list(scope).expect(503)).body.message).toBe(
        "Список пользователей временно недоступен"
      )
    } finally {
      spy.mockRestore()
    }
  })
})
