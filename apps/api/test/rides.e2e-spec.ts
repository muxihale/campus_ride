import "reflect-metadata"
import { randomInt, randomUUID } from "node:crypto"
import type { INestApplication } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { Test } from "@nestjs/testing"
import request from "supertest"
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { AppModule } from "../src/app.module.js"
import { PrismaService } from "../src/prisma/prisma.service.js"
import { configureApp } from "../src/setup.js"

const domain = `${randomUUID()}.campusride.test`
const originId = randomUUID(),
  destinationId = randomUUID(),
  stop1 = randomUUID(),
  stop2 = randomUUID()

describe("Создание черновика поездки (HTTP + PostgreSQL)", () => {
  let app: INestApplication
  let prisma: PrismaService
  let userId: string,
    otherId: string,
    cookie: string,
    vehicleId: string,
    otherVehicleId: string
  let districtId: string, campusId: string
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = module.createNestApplication()
    app.get(ConfigService).set("WEB_ORIGIN", "http://localhost:5173")
    configureApp(app)
    prisma = app.get(PrismaService)
    await app.init()
    const actors = []
    for (const name of ["driver", "other"]) {
      const result = await request(app.getHttpServer())
        .post("/api/auth/register")
        .set("Origin", "http://localhost:5173")
        .send({
          email: `${name}@${domain}`,
          fullName: "Анна Соколова",
          password: "CampusRide-2026",
        })
        .expect(201)
      await prisma.userRole.create({
        data: { userId: result.body.id, role: "DRIVER" },
      })
      const session = (
        result.headers["set-cookie"] as unknown as string[]
      )[0]!.split(";")[0]!
      const car = await request(app.getHttpServer())
        .post("/api/me/vehicles")
        .set("Origin", "http://localhost:5173")
        .set("Cookie", session)
        .send({
          make: "Kia",
          model: "Rio",
          color: "Белый",
          registrationNumber: `A${randomInt(100, 1000)}BC${randomInt(100, 1000)}`,
          passengerSeats: 3,
        })
        .expect(201)
      actors.push({
        id: result.body.id as string,
        session,
        vehicleId: car.body.id as string,
      })
    }
    userId = actors[0]!.id
    otherId = actors[1]!.id
    cookie = actors[0]!.session
    vehicleId = actors[0]!.vehicleId
    otherVehicleId = actors[1]!.vehicleId
    districtId = (
      await prisma.district.create({ data: { name: `Район ${domain}` } })
    ).id
    campusId = (
      await prisma.campus.create({ data: { name: `Корпус ${domain}` } })
    ).id
    await prisma.location.createMany({
      data: [
        {
          id: originId,
          name: "Встреча у метро",
          address: "Екатеринбург, Космонавтов",
          kind: "MEETING_POINT",
          districtId,
        },
        {
          id: destinationId,
          name: "Корпус УрФУ",
          address: "Екатеринбург, Мира, 19",
          kind: "CAMPUS",
          districtId,
          campusId,
        },
        {
          id: stop1,
          name: "Остановка 1",
          address: "Екатеринбург, Мира",
          kind: "MEETING_POINT",
          districtId,
        },
        {
          id: stop2,
          name: "Остановка 2",
          address: "Екатеринбург, Первомайская",
          kind: "TRANSIT_STOP",
          districtId,
        },
      ],
    })
  })
  afterEach(async () => {
    if (!prisma || !userId) return
    await prisma.ride.deleteMany({
      where: { driverId: { in: [userId, otherId] } },
    })
    await prisma.user.update({
      where: { id: userId },
      data: { status: "ACTIVE" },
    })
    await prisma.userRole.deleteMany({ where: { userId, role: "ADMIN" } })
    await prisma.userRole.upsert({
      where: { userId_role: { userId, role: "DRIVER" } },
      update: {},
      create: { userId, role: "DRIVER" },
    })
  })
  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.vehicle.deleteMany({
          where: { driverId: { in: [userId, otherId] } },
        })
        await prisma.driverProfile.deleteMany({
          where: { userId: { in: [userId, otherId] } },
        })
        await prisma.user.deleteMany({
          where: { email: { endsWith: `@${domain}` } },
        })
        await prisma.location.deleteMany({
          where: { id: { in: [originId, destinationId, stop1, stop2] } },
        })
        if (campusId) await prisma.campus.delete({ where: { id: campusId } })
        if (districtId)
          await prisma.district.delete({ where: { id: districtId } })
      }
    } finally {
      if (app) await app.close()
    }
  })
  function input(overrides: Record<string, unknown> = {}) {
    return {
      vehicleId,
      originId,
      destinationId,
      departureAt: new Date(Date.now() + 86400000).toISOString(),
      seatsTotal: 3,
      priceKopecks: 15000,
      conditions: "  Встречаемся у выхода из метро, у белой Kia.  ",
      ...overrides,
    }
  }
  function create(body: unknown = input()) {
    return request(app.getHttpServer())
      .post("/api/rides")
      .set("Cookie", cookie)
      .set("Origin", "http://localhost:5173")
      .send(body as object)
  }
  async function noDraft() {
    expect(await prisma.ride.count({ where: { driverId: userId } })).toBe(0)
  }

  it("создаёт только DRAFT от текущего водителя с безопасным ответом и настройками по умолчанию", async () => {
    const body = input({ priceKopecks: 0 })
    const result = await create(body)
      .expect("Cache-Control", "no-store")
      .expect(201)
    expect(result.body).toEqual({
      ...body,
      conditions: body.conditions.trim(),
      musicAllowed: true,
      luggageAllowed: false,
      smokingAllowed: false,
      id: expect.any(String),
      driverId: userId,
      status: "DRAFT",
      stops: [],
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
    const stored = await prisma.ride.findUniqueOrThrow({
      where: { id: result.body.id },
      include: { stops: true, statusEvents: true, bookings: true },
    })
    expect(stored.status).toBe("DRAFT")
    expect(stored.priceKopecks).toBe(0)
    expect(stored.statusEvents).toEqual([])
    expect(stored.bookings).toEqual([])
  })

  it("сохраняет порядок остановок, условия и время Екатеринбурга как UTC", async () => {
    const departureAt = new Date(Date.now() + 86400000 + 5 * 3600000)
      .toISOString()
      .replace("Z", "+05:00")
    const body = input({
      departureAt,
      stops: [{ locationId: stop2 }, { locationId: stop1 }],
      musicAllowed: false,
      luggageAllowed: true,
      smokingAllowed: true,
    })
    const result = await create(body).expect(201)
    expect(result.body.departureAt).toBe(new Date(departureAt).toISOString())
    expect(result.body).toMatchObject({
      musicAllowed: false,
      luggageAllowed: true,
      smokingAllowed: true,
    })
    expect(result.body.stops).toEqual([
      { id: expect.any(String), locationId: stop2, position: 1 },
      { id: expect.any(String), locationId: stop1, position: 2 },
    ])
    expect(
      await prisma.rideStop.count({ where: { rideId: result.body.id } })
    ).toBe(2)
  })

  it.each([
    { vehicleId: "bad" },
    { originId: null },
    { destinationId: "bad" },
    { departureAt: "2027-02-30T08:00:00+05:00" },
    { departureAt: "2027-01-01T08:00:00" },
    { departureAt: "not-date" },
    { departureAt: "2020-01-01T08:00:00+05:00" },
    { seatsTotal: 0 },
    { seatsTotal: 9 },
    { seatsTotal: 1.5 },
    { seatsTotal: "3" },
    { seatsTotal: 4 },
    { priceKopecks: -1 },
    { priceKopecks: 10.5 },
    { priceKopecks: "100" },
    { priceKopecks: 2147483648 },
    { conditions: " " },
    { conditions: null },
    { conditions: "x".repeat(1001) },
    { musicAllowed: "true" },
    { luggageAllowed: 1 },
    { smokingAllowed: null },
    { status: "PUBLISHED" },
    { driverId: randomUUID() },
    { id: randomUUID() },
    { availableSeats: 8 },
    { stops: null },
    { stops: {} },
    { stops: [{ locationId: "bad" }] },
    { stops: [{ locationId: randomUUID(), position: 5 }] },
    { stops: [{ locationId: randomUUID(), rideId: randomUUID() }] },
    { stops: Array.from({ length: 11 }, () => ({ locationId: randomUUID() })) },
  ])("отклоняет неверные и служебные поля без создания: %j", async (fields) => {
    await create(input(fields)).expect(400)
    await noDraft()
  })

  it("проверяет существование и уникальность всех точек, не оставляя частичных остановок", async () => {
    for (const fields of [
      { destinationId: originId },
      { originId: randomUUID() },
      { destinationId: randomUUID() },
      { stops: [{ locationId: randomUUID() }] },
      { stops: [{ locationId: originId }] },
      { stops: [{ locationId: destinationId }] },
      { stops: [{ locationId: stop1 }, { locationId: stop1 }] },
    ]) {
      await create(input(fields)).expect(400)
      await noDraft()
    }
    expect(
      await prisma.rideStop.count({
        where: { locationId: { in: [stop1, stop2] } },
      })
    ).toBe(0)
  })

  it("одинаково скрывает чужой и отсутствующий автомобиль", async () => {
    const other = await create(input({ vehicleId: otherVehicleId })).expect(404)
    const missing = await create(input({ vehicleId: randomUUID() })).expect(404)
    expect(other.body).toEqual(missing.body)
    await noDraft()
  })

  it("требует сессию, DRIVER, активный аккаунт и разрешённый Origin", async () => {
    await request(app.getHttpServer())
      .post("/api/rides")
      .set("Origin", "http://localhost:5173")
      .send(input())
      .expect(401)
    for (const origin of [undefined, "https://evil.example"]) {
      const call = request(app.getHttpServer())
        .post("/api/rides")
        .set("Cookie", cookie)
      if (origin) call.set("Origin", origin)
      await call.send(input()).expect(403)
    }
    await prisma.userRole.deleteMany({ where: { userId, role: "DRIVER" } })
    await create().expect(403)
    await prisma.userRole.create({ data: { userId, role: "ADMIN" } })
    await create().expect(403)
    await prisma.user.update({
      where: { id: userId },
      data: { status: "BLOCKED" },
    })
    await create().expect(401)
    await noDraft()
  })

  it("откатывает ошибку БД и не раскрывает детали подключения", async () => {
    const transaction = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(new Error("private database credentials"))
    try {
      const result = await create().expect(503)
      expect(result.body.message).toBe(
        "Не удалось создать черновик поездки. Повторите позже"
      )
      expect(result.text).not.toContain("private database credentials")
      await noDraft()
    } finally {
      transaction.mockRestore()
    }
  })

  it("публикует только реализованный POST в Swagger без будущего поиска и публикации", async () => {
    const result = await request(app.getHttpServer())
      .get("/api/docs-json")
      .expect(200)
    expect(result.body.paths["/api/rides"].post).toBeDefined()
    expect(result.body.paths["/api/rides"].get).toBeUndefined()
    expect(result.body.paths["/api/rides/{id}/publish"]).toBeUndefined()
  })
})
