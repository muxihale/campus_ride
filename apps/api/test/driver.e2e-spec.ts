import "reflect-metadata"
import { randomInt, randomUUID } from "node:crypto"
import type { INestApplication } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { Test } from "@nestjs/testing"
import request from "supertest"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { AppModule } from "../src/app.module.js"
import { PrismaService } from "../src/prisma/prisma.service.js"
import { configureApp } from "../src/setup.js"

describe("Подключение водителя (HTTP + PostgreSQL)", () => {
  let app: INestApplication
  let prisma: PrismaService
  let domain: string
  let cookie: string
  let userId: string
  let plate: string
  beforeEach(async () => {
    domain = `${randomUUID()}.campusride.test`
    plate = `A${randomInt(100, 1000)}BC${randomInt(100, 1000)}`
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = module.createNestApplication()
    app.get(ConfigService).set("WEB_ORIGIN", "http://localhost:5173")
    configureApp(app)
    prisma = app.get(PrismaService)
    await app.init()
    const result = await register("anna")
    userId = result.body.id
    cookie = (result.headers["set-cookie"] as unknown as string[])[0]!.split(
      ";"
    )[0]!
  })
  afterEach(async () => {
    try {
      if (prisma) {
        const where = { user: { email: { endsWith: `@${domain}` } } }
        await prisma.vehicle.deleteMany({ where: { driver: where } })
        await prisma.driverProfile.deleteMany({ where })
        await prisma.user.deleteMany({
          where: { email: { endsWith: `@${domain}` } },
        })
      }
    } finally {
      if (app) await app.close()
    }
  })
  function register(name: string) {
    return request(app.getHttpServer())
      .post("/api/auth/register")
      .set("Origin", "http://localhost:5173")
      .send({
        email: `${name}@${domain}`,
        fullName: "Анна Соколова",
        password: "CampusRide-2026",
      })
      .expect(201)
  }
  function input(vehicle: Record<string, unknown> = {}) {
    return {
      bio: "  Езжу в УрФУ к 8:30.  ",
      vehicle: {
        make: " Kia ",
        model: " Rio ",
        color: " Белый ",
        registrationNumber: plate,
        passengerSeats: 3,
        ...vehicle,
      },
    }
  }
  function create(body: unknown = input(), session = cookie) {
    return request(app.getHttpServer())
      .post("/api/me/driver-profile")
      .set("Cookie", session)
      .set("Origin", "http://localhost:5173")
      .send(body as object)
  }
  async function unchanged() {
    expect(await prisma.driverProfile.count({ where: { userId } })).toBe(0)
    expect(await prisma.vehicle.count({ where: { driverId: userId } })).toBe(0)
    expect(await prisma.userRole.findMany({ where: { userId } })).toEqual([
      { userId, role: "PASSENGER" },
    ])
  }

  it("атомарно создаёт профиль, автомобиль и роль, сохраняет пассажира и действующую сессию", async () => {
    const result = await create(
      input({
        registrationNumber: plate.replace("A", "а").replace("BC", "вс "),
      })
    )
      .expect("Cache-Control", "no-store")
      .expect(201)
    expect(result.body).toMatchObject({
      id: userId,
      roles: expect.arrayContaining(["PASSENGER", "DRIVER"]),
    })
    expect(Object.keys(result.body).sort((a, b) => a.localeCompare(b))).toEqual(
      ["affiliation", "email", "fullName", "id", "phone", "roles"]
    )
    const driver = await prisma.driverProfile.findUniqueOrThrow({
      where: { userId },
      include: { vehicles: true },
    })
    expect(driver.bio).toBe("Езжу в УрФУ к 8:30.")
    expect(driver.vehicles).toHaveLength(1)
    expect(driver.vehicles[0]).toMatchObject({
      driverId: userId,
      make: "Kia",
      model: "Rio",
      color: "Белый",
      registrationNumber: plate,
      passengerSeats: 3,
    })
    const me = await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Cookie", cookie)
      .expect(200)
    expect(me.body.roles).toEqual(
      expect.arrayContaining(["PASSENGER", "DRIVER"])
    )
  })

  it("повторное и параллельное подключение не создают лишние автомобили", async () => {
    const results = await Promise.all([create(), create()])
    expect(results.map(({ status }) => status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ])
    await create(input({ registrationNumber: "X999XX999" })).expect(409)
    expect(await prisma.vehicle.count({ where: { driverId: userId } })).toBe(1)
    expect(await prisma.userRole.count({ where: { userId } })).toBe(2)
  })

  it("занятый нормализованный номер откатывает профиль и роль другого пользователя", async () => {
    const other = await register("other")
    const otherCookie = (
      other.headers["set-cookie"] as unknown as string[]
    )[0]!.split(";")[0]!
    await create(input(), otherCookie).expect(201)
    await create(input({ registrationNumber: plate.toLowerCase() })).expect(409)
    await unchanged()
  })

  it.each([
    { make: " " },
    { make: "x".repeat(61) },
    { model: null },
    { color: "x".repeat(41) },
    { registrationNumber: "invalid" },
    { passengerSeats: 0 },
    { passengerSeats: 9 },
    { passengerSeats: 1.5 },
    { passengerSeats: true },
    { passengerSeats: "3" },
    { driverId: randomUUID() },
    { id: randomUUID() },
    { roles: ["ADMIN"] },
  ])("отклоняет неверные и лишние поля автомобиля: %j", async (vehicle) => {
    await create(input(vehicle)).expect(400)
    await unchanged()
  })

  it.each([
    {},
    { vehicle: null },
    { vehicle: [] },
    { bio: "x".repeat(1001) },
    { userId: randomUUID() },
    { roles: ["ADMIN"] },
  ])("отклоняет неверные поля запроса: %j", async (override) => {
    const body = Object.keys(override).length ? { ...input(), ...override } : {}
    await create(body).expect(400)
    await unchanged()
  })

  it("требует сессию, роль пассажира, активный аккаунт и разрешённый Origin", async () => {
    await request(app.getHttpServer())
      .post("/api/me/driver-profile")
      .set("Origin", "http://localhost:5173")
      .send(input())
      .expect(401)
    for (const origin of [undefined, "https://evil.example"]) {
      const call = request(app.getHttpServer())
        .post("/api/me/driver-profile")
        .set("Cookie", cookie)
      if (origin) call.set("Origin", origin)
      await call.send(input()).expect(403)
    }
    await prisma.userRole.deleteMany({ where: { userId } })
    await prisma.userRole.create({ data: { userId, role: "ADMIN" } })
    await create().expect(403)
    await prisma.user.update({
      where: { id: userId },
      data: { status: "BLOCKED" },
    })
    await create().expect(401)
    expect(await prisma.driverProfile.count({ where: { userId } })).toBe(0)
  })
})
