import "reflect-metadata"
import { randomUUID } from "node:crypto"
import type { INestApplication } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { Test } from "@nestjs/testing"
import request from "supertest"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppModule } from "../src/app.module.js"
import { PrismaService } from "../src/prisma/prisma.service.js"
import { configureApp } from "../src/setup.js"

describe("Собственный профиль (HTTP + PostgreSQL)", () => {
  let app: INestApplication
  let prisma: PrismaService
  let cookie: string
  let userId: string
  let domain: string
  beforeEach(async () => {
    domain = `${randomUUID()}.campusride.test`
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = module.createNestApplication()
    app.get(ConfigService).set("WEB_ORIGIN", "http://localhost:5173")
    configureApp(app)
    prisma = app.get(PrismaService)
    await app.init()
    const registered = await request(app.getHttpServer())
      .post("/api/auth/register")
      .set("Origin", "http://localhost:5173")
      .send({
        email: `anna@${domain}`,
        fullName: "Анна Соколова",
        password: "CampusRide-2026",
      })
      .expect(201)
    cookie = (
      registered.headers["set-cookie"] as unknown as string[]
    )[0]!.split(";")[0]!
    userId = registered.body.id
  })
  afterEach(async () => {
    try {
      if (prisma)
        await prisma.user.deleteMany({
          where: { email: { endsWith: `@${domain}` } },
        })
    } finally {
      if (app) await app.close()
    }
  })
  function patch(input: unknown) {
    return request(app.getHttpServer())
      .patch("/api/me")
      .set("Cookie", cookie)
      .set("Origin", "http://localhost:5173")
      .send(input as object)
  }

  it("возвращает только безопасные поля собственного профиля", async () => {
    const result = await request(app.getHttpServer())
      .get("/api/me")
      .set("Cookie", cookie)
      .expect("Cache-Control", "no-store")
      .expect(200)
    expect(result.body).toEqual({
      id: userId,
      email: `anna@${domain}`,
      fullName: "Анна Соколова",
      phone: null,
      affiliation: null,
      roles: ["PASSENGER"],
    })
  })

  it("сохраняет нормализованные поля, не меняет пароль, роли и сессию", async () => {
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { sessions: true, roles: true },
    })
    const result = await patch({
      fullName: "  Анна Иванова  ",
      phone: "  +7 (912) 345-67-89  ",
      affiliation: "  Студент УрФУ  ",
    })
      .expect("Cache-Control", "no-store")
      .expect(200)
    expect(result.body).toMatchObject({
      fullName: "Анна Иванова",
      phone: "+7 (912) 345-67-89",
      affiliation: "Студент УрФУ",
    })
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { sessions: true, roles: true },
    })
    expect(after.passwordHash).toBe(before.passwordHash)
    expect(after.sessions).toEqual(before.sessions)
    expect(after.roles).toEqual(before.roles)
    await request(app.getHttpServer())
      .get("/api/me")
      .set("Cookie", cookie)
      .expect(200, result.body)
    const auth = await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Cookie", cookie)
      .expect(200)
    expect(auth.body.fullName).toBe("Анна Иванова")
  })

  it("частичное обновление сохраняет пропущенные поля, пустые строки и null очищают необязательные поля", async () => {
    await patch({ phone: "+79123456789", affiliation: "УрФУ" }).expect(200)
    const partial = await patch({ fullName: "Анна Иванова" }).expect(200)
    expect(partial.body).toMatchObject({
      phone: "+79123456789",
      affiliation: "УрФУ",
    })
    const cleared = await patch({ phone: "  ", affiliation: null }).expect(200)
    expect(cleared.body).toMatchObject({
      phone: null,
      affiliation: null,
      fullName: "Анна Иванова",
    })
  })

  it.each([
    { fullName: null },
    { fullName: " " },
    { fullName: "x".repeat(101) },
    { fullName: 123 },
    { phone: "abc" },
    { phone: "1".repeat(33) },
    { phone: 1234567890 },
    { affiliation: "x".repeat(201) },
    { roles: ["ADMIN"] },
    { role: "DRIVER" },
    { status: "BLOCKED" },
    { email: "other@example.ru" },
    { id: randomUUID() },
    { userId: randomUUID() },
    { passwordHash: "changed" },
    { password: "Changed-password" },
  ])(
    "отклоняет невалидные и запрещённые поля без частичного сохранения: %j",
    async (fields) => {
      await patch({ fullName: "Изменённое имя", ...fields }).expect(400)
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: userId } }))
          .fullName
      ).toBe("Анна Соколова")
    }
  )

  it("не позволяет выбрать чужой профиль через URL или поля запроса", async () => {
    const other = await prisma.user.create({
      data: {
        email: `other@${domain}`,
        fullName: "Другой пользователь",
        passwordHash: "unused",
      },
    })
    await patch({ id: other.id, fullName: "Чужое имя" }).expect(400)
    await request(app.getHttpServer())
      .patch(`/api/me/${other.id}`)
      .set("Cookie", cookie)
      .set("Origin", "http://localhost:5173")
      .send({ fullName: "Чужое имя" })
      .expect(404)
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: other.id } }))
        .fullName
    ).toBe("Другой пользователь")
  })

  it.each([undefined, "https://evil.example", "null"])(
    "отклоняет Origin %s",
    async (origin) => {
      const call = request(app.getHttpServer())
        .patch("/api/me")
        .set("Cookie", cookie)
      if (origin) call.set("Origin", origin)
      await call.send({ fullName: "Чужой запрос" }).expect(403)
    }
  )

  it("при сбое чтения профиля возвращает 503 без внутренних деталей БД", async () => {
    const read = vi
      .spyOn(prisma.user, "findUniqueOrThrow")
      .mockRejectedValueOnce(new Error("private database credentials"))
    try {
      const result = await request(app.getHttpServer())
        .get("/api/me")
        .set("Cookie", cookie)
        .expect(503)
      expect(result.body.message).toBe("Профиль временно недоступен")
      expect(result.text).not.toContain("private database credentials")
    } finally {
      read.mockRestore()
    }
  })

  it("требует активную сессию для чтения и изменения", async () => {
    for (const method of ["get", "patch"] as const) {
      await request(app.getHttpServer())
        [method]("/api/me")
        .set("Origin", "http://localhost:5173")
        .expect(401)
    }
    await prisma.user.update({
      where: { id: userId },
      data: { status: "BLOCKED" },
    })
    await request(app.getHttpServer())
      .get("/api/me")
      .set("Cookie", cookie)
      .expect(401)
    await patch({ fullName: "Новое имя" }).expect(401)
  })
})
