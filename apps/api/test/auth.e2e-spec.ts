import "reflect-metadata"
import { randomUUID } from "node:crypto"
import { type INestApplication } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { Test } from "@nestjs/testing"
import { verify } from "@node-rs/argon2"
import request from "supertest"
import type { Response } from "supertest"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { AppModule } from "../src/app.module.js"
import {
  hashSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from "../src/auth/auth.service.js"
import { PrismaService } from "../src/prisma/prisma.service.js"
import { configureApp } from "../src/setup.js"

describe("Регистрация и сессии (HTTP + PostgreSQL)", () => {
  let app: INestApplication
  let prisma: PrismaService
  let domain: string
  const password = "  CampusRide 2026  "

  beforeEach(async () => {
    domain = `${randomUUID()}.campusride.test`
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = module.createNestApplication()
    app.get(ConfigService).set("NODE_ENV", "test")
    app.get(ConfigService).set("WEB_ORIGIN", "http://localhost:5173")
    configureApp(app)
    prisma = app.get(PrismaService)
    await app.init()
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

  function register(overrides: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post("/api/auth/register")
      .set("Origin", "http://localhost:5173")
      .send({
        email: `student@${domain}`,
        password,
        fullName: "Анна Соколова",
        ...overrides,
      })
  }

  function sessionCookie(response: Response) {
    const cookies = response.headers["set-cookie"] as unknown as string[]
    expect(cookies).toHaveLength(1)
    const header = cookies[0]!
    const cookie = header.split(";")[0]!
    const token = cookie.slice(`${SESSION_COOKIE}=`.length)
    return { header, cookie, token }
  }

  it("атомарно создаёт пассажира, Argon2id-хеш и семидневную сессию без секретов в JSON", async () => {
    const start = Date.now()
    const response = await register({
      affiliation: "  Студент ИРИТ-РТФ  ",
    }).expect(201)
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.body).toEqual({
      id: expect.any(String),
      email: `student@${domain}`,
      fullName: "Анна Соколова",
      affiliation: "Студент ИРИТ-РТФ",
      roles: ["PASSENGER"],
    })
    const { header, token } = sessionCookie(response)
    expect(header).toContain("HttpOnly")
    expect(header).toContain("SameSite=Lax")
    expect(header).toContain("Path=/")
    expect(header).toContain("Max-Age=604800")
    expect(header).not.toContain("Secure")
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: response.body.id },
      include: { sessions: true, roles: true },
    })
    expect(user.passwordHash).toMatch(/^\$argon2id\$/)
    expect(await verify(user.passwordHash, password)).toBe(true)
    expect(await verify(user.passwordHash, password.trim())).toBe(false)
    expect(user.roles.map(({ role }) => role)).toEqual(["PASSENGER"])
    expect(user.sessions).toHaveLength(1)
    const session = user.sessions[0]!
    expect(session.tokenHash).toBe(hashSessionToken(token))
    expect(session.tokenHash).not.toBe(token)
    expect(session.expiresAt.getTime()).toBeGreaterThanOrEqual(
      start + SESSION_TTL_MS
    )
    expect(session.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + SESSION_TTL_MS
    )
    expect(response.text).not.toContain(token)
    expect(response.text).not.toContain(user.passwordHash)
    expect(response.text).not.toContain(session.tokenHash)
  })

  it("возвращает текущего пользователя по выданной cookie и сохраняет сессию между запросами", async () => {
    const created = await register().expect(201)
    const { cookie } = sessionCookie(created)
    for (let attempt = 0; attempt < 2; attempt++) {
      await request(app.getHttpServer())
        .get("/api/auth/me")
        .set("Cookie", cookie)
        .expect("Cache-Control", "no-store")
        .expect(200, created.body)
    }
  })

  it("нормализует email и имя, отклоняет повторный email без лишних записей", async () => {
    const created = await register({
      email: `  STUDENT@${domain.toUpperCase()}  `,
      fullName: "  Анна Соколова  ",
    }).expect(201)
    expect(created.body.email).toBe(`student@${domain}`)
    expect(created.body.fullName).toBe("Анна Соколова")
    const duplicate = await register().expect(409)
    expect(duplicate.headers["set-cookie"]).toBeUndefined()
    expect(
      await prisma.user.count({ where: { email: `student@${domain}` } })
    ).toBe(1)
    expect(
      await prisma.session.count({ where: { userId: created.body.id } })
    ).toBe(1)
  })

  it("при двух параллельных регистрациях одного email создаёт только один аккаунт и сессию", async () => {
    const results = await Promise.all([register(), register()])
    expect(
      results.map(({ status }) => status).sort((left, right) => left - right)
    ).toEqual([201, 409])
    const users = await prisma.user.findMany({
      where: { email: `student@${domain}` },
      include: { sessions: true },
    })
    expect(users).toHaveLength(1)
    expect(users[0]!.sessions).toHaveLength(1)
  })

  it.each([
    { email: "not-an-email" },
    { password: "short" },
    { password: "x".repeat(129) },
    { password: 12345678901 },
    { fullName: "   " },
    { fullName: "x".repeat(101) },
    { affiliation: "x".repeat(201) },
    { roles: ["ADMIN"] },
    { role: "DRIVER" },
    { status: "ACTIVE" },
    { id: randomUUID() },
  ])("отклоняет неверные или лишние поля: %j", async (fields) => {
    const response = await register(fields).expect(400)
    expect(response.headers["set-cookie"]).toBeUndefined()
    expect(
      await prisma.user.count({ where: { email: { endsWith: `@${domain}` } } })
    ).toBe(0)
  })

  it.each([undefined, "https://evil.example", "null"])(
    "отклоняет отсутствующий или чужой Origin: %s",
    async (origin) => {
      const call = request(app.getHttpServer()).post("/api/auth/register")
      if (origin !== undefined) call.set("Origin", origin)
      await call
        .send({
          email: `student@${domain}`,
          password,
          fullName: "Анна Соколова",
        })
        .expect(403)
      expect(
        await prisma.user.count({
          where: { email: { endsWith: `@${domain}` } },
        })
      ).toBe(0)
    }
  )

  it.each([undefined, "invalid", "x".repeat(43)])(
    "не авторизует без действительного токена: %s",
    async (token) => {
      const call = request(app.getHttpServer()).get("/api/auth/me")
      if (token !== undefined) call.set("Cookie", `${SESSION_COOKIE}=${token}`)
      await call.expect(401)
    }
  )

  it.each(["expired", "blocked", "revoked"])(
    "отклоняет недействительную сессию: %s",
    async (reason) => {
      const created = await register().expect(201)
      const { cookie, token } = sessionCookie(created)
      if (reason === "expired")
        await prisma.session.update({
          where: { tokenHash: hashSessionToken(token) },
          data: { expiresAt: new Date(Date.now() - 1000) },
        })
      if (reason === "blocked")
        await prisma.user.update({
          where: { id: created.body.id },
          data: { status: "BLOCKED" },
        })
      if (reason === "revoked")
        await prisma.session.delete({
          where: { tokenHash: hashSessionToken(token) },
        })
      await request(app.getHttpServer())
        .get("/api/auth/me")
        .set("Cookie", cookie)
        .expect(401)
    }
  )

  it("ставит Secure cookie в production", async () => {
    app.get(ConfigService).set("NODE_ENV", "production")
    const response = await register().expect(201)
    expect(sessionCookie(response).header).toContain("Secure")
  })

  it("ограничивает регистрацию десятью попытками в минуту, включая невалидные формы", async () => {
    for (let attempt = 0; attempt < 10; attempt++)
      await register({ password: "short" }).expect(400)
    const response = await register().expect(429)
    expect(Number(response.headers["retry-after"])).toBeGreaterThan(0)
    expect(
      await prisma.user.count({ where: { email: { endsWith: `@${domain}` } } })
    ).toBe(0)
  })
})
