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
const domain = `${randomUUID()}.activity.campusride.test`
describe("Собственная история всех ролей (HTTP + PostgreSQL)", () => {
  let app: INestApplication, prisma: PrismaService
  const accounts: { id: string; cookie: string }[] = [],
    rows: { id: string; action: string }[] = []
  const resourceId = randomUUID()
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = module.createNestApplication()
    configureApp(app)
    prisma = app.get(PrismaService)
    await app.init()
    const roleSets: Role[][] = [
      ["PASSENGER"],
      ["DRIVER"],
      ["ADMIN"],
      ["PASSENGER"],
      [],
    ]
    for (const [index, roles] of roleSets.entries()) {
      const token = randomBytes(32).toString("base64url")
      const user = await prisma.user.create({
        data: {
          email: `${index}@${domain}`,
          fullName: "Анна Соколова",
          passwordHash: "private-password",
          status: index === 3 ? "BLOCKED" : "ACTIVE",
          roles: { create: roles.map((role) => ({ role })) },
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
    const events = [
      {
        actor: 0,
        action: "review.created",
        type: "review",
        day: 20,
        reason: null,
      },
      {
        actor: 0,
        action: "booking.cancelled",
        type: "booking",
        day: 21,
        reason: "Перенос 100%_",
      },
      {
        actor: 0,
        action: "payment.refunded",
        type: "payment",
        day: 21,
        reason: null,
      },
      {
        actor: 0,
        action: "booking.cancelled",
        type: "booking",
        day: 22,
        reason: { password: "raw-secret" },
      },
      {
        actor: 0,
        action: "auth.private",
        type: "user",
        day: 23,
        reason: "private-action",
      },
      { actor: 1, action: "ride.started", type: "ride", day: 20, reason: null },
      {
        actor: 1,
        action: "ride.completed",
        type: "ride",
        day: 21,
        reason: null,
      },
      {
        actor: 2,
        action: "user.blocked",
        type: "user",
        day: 20,
        reason: "Решение администратора",
      },
      {
        actor: 2,
        action: "review.hidden",
        type: "review",
        day: 21,
        reason: "Нарушение правил",
      },
      { actor: 2, action: "ride.started", type: "ride", day: 22, reason: null },
    ]
    for (const event of events) {
      const row = await prisma.activityLog.create({
        data: {
          actorId: accounts[event.actor]!.id,
          action: event.action,
          resourceType: event.type,
          resourceId,
          createdAt: new Date(`2026-10-${event.day}T12:00:00Z`),
          details: {
            reason: event.reason,
            passwordHash: "private-hash",
            token: "private-token",
            email: "private@example.ru",
          },
        },
      })
      rows.push({ id: row.id, action: row.action })
    }
    await prisma.activityLog.create({
      data: {
        actorId: null,
        action: "review.created",
        resourceType: "review",
        resourceId,
        details: { reason: "Системная запись" },
      },
    })
  })
  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.activityLog.deleteMany({
          where: {
            OR: [
              { actorId: { in: accounts.map((a) => a.id) } },
              { actorId: null, resourceId },
            ],
          },
        })
        await prisma.user.deleteMany({
          where: { id: { in: accounts.map((a) => a.id) } },
        })
      }
    } finally {
      if (app) await app.close()
    }
  })
  const list = (query = "", account = 0) =>
    request(app.getHttpServer())
      .get(`/api/me/activity?${query}`)
      .set("Cookie", accounts[account]!.cookie)
  it.each([
    [0, 4],
    [1, 2],
    [2, 3],
  ])(
    "роль аккаунта %s читает только свои %s записи",
    async (account, total) => {
      const result = await list("", account).expect(200)
      expect(result.headers["cache-control"]).toBe("no-store")
      expect(result.body).toMatchObject({ total, page: 1, pageSize: 20 })
      expect(Object.keys(result.body.items[0]).sort()).toEqual(
        [
          "id",
          "action",
          "resourceType",
          "resourceId",
          "reason",
          "createdAt",
        ].sort()
      )
      const text = JSON.stringify(result.body)
      expect(text).not.toMatch(
        /private-|raw-secret|passwordHash|token|email|details|Системная запись/
      )
      if (account === 0)
        expect(text).not.toMatch(/ride.started|user.blocked|Нарушение правил/)
      if (account === 2) expect(text).not.toMatch(/Перенос/)
    }
  )
  it("сочетает поиск и четыре параметра фильтрации с включёнными границами", async () => {
    const query = `q=${encodeURIComponent("ПЕРЕНОС")}&action=booking.cancelled&resourceType=booking&resourceId=${resourceId}&dateFrom=2026-10-21T12:00:00Z&dateTo=2026-10-21T12:00:00Z`
    const result = await list(query).expect(200)
    expect(result.body.total).toBe(1)
    expect(result.body.items[0]).toMatchObject({
      id: rows[1]!.id,
      reason: "Перенос 100%_",
    })
    expect((await list("q=%25_").expect(200)).body.total).toBe(1)
    expect((await list("q=raw-secret").expect(200)).body.total).toBe(0)
    expect((await list("q=private-token").expect(200)).body.total).toBe(0)
    expect(
      (await list(`resourceId=${randomUUID()}`).expect(200)).body.total
    ).toBe(0)
  })
  it("пагинация стабильно разделяет записи с одинаковым временем", async () => {
    const ids = [rows[1]!.id, rows[2]!.id].sort()
    const query =
      "dateFrom=2026-10-21T12:00:00Z&dateTo=2026-10-21T12:00:00Z&sort=oldest&pageSize=1"
    for (const [i, id] of ids.entries())
      expect(
        (await list(`${query}&page=${i + 1}`).expect(200)).body.items[0].id
      ).toBe(id)
    expect((await list("page=99&pageSize=1").expect(200)).body).toEqual({
      items: [],
      total: 4,
      page: 99,
      pageSize: 1,
    })
    const newest = (await list("pageSize=1").expect(200)).body.items[0]
    expect(newest).toMatchObject({ id: rows[3]!.id, reason: null })
  })
  it("сохраняет прежний ограниченный административный маршрут", async () => {
    const result = await request(app.getHttpServer())
      .get("/api/admin/activity")
      .set("Cookie", accounts[2]!.cookie)
      .expect(200)
    expect(result.body.total).toBe(2)
    expect(
      result.body.items.map((row: { action: string }) => row.action).sort()
    ).toEqual(["review.hidden", "user.blocked"])
    await request(app.getHttpServer())
      .get("/api/admin/activity")
      .set("Cookie", accounts[0]!.cookie)
      .expect(403)
  })
  it("требует действующую сессию и одну из трёх ролей", async () => {
    await request(app.getHttpServer()).get("/api/me/activity").expect(401)
    await list("", 3).expect(401)
    await list("", 4).expect(403)
    await prisma.session.updateMany({
      where: { userId: accounts[1]!.id },
      data: { expiresAt: new Date("2000-01-01") },
    })
    try {
      await list("", 1).expect(401)
    } finally {
      await prisma.session.updateMany({
        where: { userId: accounts[1]!.id },
        data: { expiresAt: new Date(Date.now() + 3600000) },
      })
    }
  })
  it.each([
    "actorId=" + randomUUID(),
    "userId=" + randomUUID(),
    "resourceType=session",
    "resourceId=bad",
    "action=auth.private",
    "dateFrom=bad",
    "dateTo=2026-10-21",
    "dateFrom=2027-01-01T00:00:00Z&dateTo=2026-01-01T00:00:00Z",
    "page=0",
    "pageSize=101",
    "sort=random",
    "q=" + "а".repeat(101),
  ])("отклоняет неверные параметры или подмену автора %s", async (query) => {
    await list(query).expect(400)
  })
  it("ошибка чтения не раскрывает БД и не возвращает частичный список", async () => {
    const spy = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(new Error("private connection failure"))
    try {
      expect((await list().expect(503)).body.message).toBe(
        "История действий временно недоступна"
      )
    } finally {
      spy.mockRestore()
    }
  })
})
