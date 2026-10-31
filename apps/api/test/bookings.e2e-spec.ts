import "reflect-metadata"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import type { INestApplication } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { ConfigService } from "@nestjs/config"
import request from "supertest"
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { AppModule } from "../src/app.module.js"
import { PrismaService } from "../src/prisma/prisma.service.js"
import { configureApp } from "../src/setup.js"
import type {
  BookingStatus,
  RideStatus,
} from "../src/generated/prisma/enums.js"
const domain = `${randomUUID()}.bookings.campusride.test`
const origin = "http://localhost:5173"
describe("Создание заявки (HTTP + PostgreSQL)", () => {
  let app: INestApplication, prisma: PrismaService
  let driver: string,
    vehicle: string,
    district: string,
    start: string,
    finish: string,
    rideId: string
  const accounts: { id: string; cookie: string }[] = [],
    rides: string[] = []
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = module.createNestApplication()
    app.get(ConfigService).set("WEB_ORIGIN", origin)
    configureApp(app)
    prisma = app.get(PrismaService)
    await app.init()
    for (let i = 0; i < 4; i++) {
      const token = randomBytes(32).toString("base64url")
      const user = await prisma.user.create({
        data: {
          email: `${i}@${domain}`,
          fullName: "Анна Соколова",
          passwordHash: "test-only",
          roles: {
            create:
              i === 3
                ? [{ role: "ADMIN" }]
                : i === 0
                  ? [{ role: "PASSENGER" }, { role: "DRIVER" }]
                  : [{ role: "PASSENGER" }],
          },
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
    driver = accounts[0]!.id
    await prisma.driverProfile.create({ data: { userId: driver } })
    vehicle = (
      await prisma.vehicle.create({
        data: {
          driverId: driver,
          make: "Kia",
          model: "Rio",
          color: "Белый",
          registrationNumber: randomUUID(),
          passengerSeats: 3,
        },
      })
    ).id
    district = (await prisma.district.create({ data: { name: domain } })).id
    start = (
      await prisma.location.create({
        data: { name: "Уралмаш", address: "Космонавтов", districtId: district },
      })
    ).id
    finish = (
      await prisma.location.create({
        data: { name: "УрФУ", address: "Мира, 19", districtId: district },
      })
    ).id
  })
  beforeEach(async () => {
    rideId = (
      await prisma.ride.create({
        data: {
          driverId: driver,
          vehicleId: vehicle,
          originId: start,
          destinationId: finish,
          departureAt: new Date("2099-11-09T03:00:00Z"),
          seatsTotal: 3,
          priceKopecks: 15015,
          status: "PUBLISHED",
        },
      })
    ).id
    rides.push(rideId)
  })
  afterAll(async () => {
    vi.restoreAllMocks()
    try {
      if (prisma) {
        await prisma.bookingStatusEvent.deleteMany({
          where: { booking: { rideId: { in: rides } } },
        })
        await prisma.booking.deleteMany({ where: { rideId: { in: rides } } })
        await prisma.ride.deleteMany({ where: { id: { in: rides } } })
        if (driver) {
          await prisma.vehicle.deleteMany({ where: { driverId: driver } })
          await prisma.driverProfile.deleteMany({ where: { userId: driver } })
        }
        await prisma.user.deleteMany({
          where: { email: { endsWith: `@${domain}` } },
        })
        if (district) {
          await prisma.location.deleteMany({ where: { districtId: district } })
          await prisma.district.delete({ where: { id: district } })
        }
      }
    } finally {
      if (app) await app.close()
    }
  })
  const send = (
    body: object = { seats: 1, requestKey: randomUUID() },
    account = 1,
    id = rideId
  ) =>
    request(app.getHttpServer())
      .post(`/api/rides/${id}/bookings`)
      .set("Origin", origin)
      .set("Cookie", accounts[account]!.cookie)
      .send(body)
  it("создаёт PENDING с серверной ценой и одним событием, уменьшает публичный остаток", async () => {
    const key = randomUUID()
    const result = await send({ seats: 2, requestKey: key }).expect(201)
    expect(result.headers["cache-control"]).toBe("no-store")
    expect(result.body).toEqual({
      id: expect.any(String),
      rideId,
      passengerId: accounts[1]!.id,
      requestKey: key,
      seats: 2,
      unitPriceKopecks: 15015,
      status: "PENDING",
      createdAt: expect.any(String),
    })
    const events = await prisma.bookingStatusEvent.findMany({
      where: { bookingId: result.body.id },
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      fromStatus: null,
      toStatus: "PENDING",
      actorId: accounts[1]!.id,
    })
    const detail = await request(app.getHttpServer())
      .get(`/api/rides/${rideId}`)
      .expect(200)
    expect(detail.body.availableSeats).toBe(1)
    expect(
      await prisma.payment.count({ where: { bookingId: result.body.id } })
    ).toBe(0)
  })
  it("повтор ключа возвращает ту же заявку даже при заполненной поездке", async () => {
    const body = { seats: 3, requestKey: randomUUID() }
    const first = await send(body).expect(201),
      second = await send(body).expect(200)
    expect(second.body).toEqual(first.body)
    expect(await prisma.booking.count({ where: { rideId } })).toBe(1)
    expect(
      await prisma.bookingStatusEvent.count({
        where: { bookingId: first.body.id },
      })
    ).toBe(1)
  })
  it("конкурирующие повторы одного ключа создают одну заявку", async () => {
    const body = { seats: 2, requestKey: randomUUID() }
    const results = await Promise.all([send(body), send(body)])
    expect(results.map((r) => r.status).sort()).toEqual([200, 201])
    expect(results[0]!.body.id).toBe(results[1]!.body.id)
    expect(await prisma.booking.count({ where: { rideId } })).toBe(1)
  })
  it("не допускает перепродажу при одновременных запросах разных пассажиров", async () => {
    const results = await Promise.all([
      send({ seats: 2, requestKey: randomUUID() }, 1),
      send({ seats: 2, requestKey: randomUUID() }, 2),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([201, 409])
    expect(
      (
        await prisma.booking.aggregate({
          where: { rideId },
          _sum: { seats: true },
        })
      )._sum.seats
    ).toBe(2)
  })
  it("не допускает две активные заявки одного пассажира с разными ключами", async () => {
    const results = await Promise.all([send(), send()])
    expect(results.map((r) => r.status).sort()).toEqual([201, 409])
  })
  it("запрещает повторный ключ с другим количеством мест или пассажиром", async () => {
    const requestKey = randomUUID()
    await send({ seats: 1, requestKey }).expect(201)
    await send({ seats: 2, requestKey }).expect(409)
    await send({ seats: 1, requestKey }, 2).expect(409)
  })
  it("не принимает ключ другой поездки", async () => {
    const requestKey = randomUUID()
    await send({ seats: 1, requestKey }).expect(201)
    const second = await prisma.ride.create({
      data: {
        driverId: driver,
        vehicleId: vehicle,
        originId: start,
        destinationId: finish,
        departureAt: new Date("2099-11-10T03:00:00Z"),
        seatsTotal: 3,
        priceKopecks: 0,
        status: "PUBLISHED",
      },
    })
    rides.push(second.id)
    await send({ seats: 1, requestKey }, 1, second.id).expect(409)
  })
  it("считает UUID ключа без учёта регистра", async () => {
    const requestKey = randomUUID()
    const first = await send({ seats: 1, requestKey }).expect(201)
    const second = await send(
      { seats: 1, requestKey: requestKey.toUpperCase() },
      1,
      rideId.toUpperCase()
    ).expect(200)
    expect(second.body.id).toBe(first.body.id)
  })
  it.each(["PENDING", "CONFIRMED"] as BookingStatus[])(
    "учитывает резерв %s",
    async (status) => {
      await prisma.booking.create({
        data: {
          rideId,
          passengerId: accounts[2]!.id,
          requestKey: randomUUID(),
          seats: 2,
          unitPriceKopecks: 15015,
          status,
        },
      })
      await send({ seats: 2, requestKey: randomUUID() }).expect(409)
      await send().expect(201)
      await request(app.getHttpServer()).get(`/api/rides/${rideId}`).expect(404)
    }
  )
  it.each(["CANCELLED", "REJECTED", "COMPLETED"] as BookingStatus[])(
    "не резервирует места по %s и допускает новую заявку",
    async (status) => {
      await prisma.booking.create({
        data: {
          rideId,
          passengerId: accounts[1]!.id,
          requestKey: randomUUID(),
          seats: 3,
          unitPriceKopecks: 15015,
          status,
        },
      })
      await send({ seats: 3, requestKey: randomUUID() }).expect(201)
    }
  )
  it.each(["DRAFT", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as RideStatus[])(
    "не бронирует %s",
    async (status) => {
      await prisma.ride.update({ where: { id: rideId }, data: { status } })
      await send().expect(404)
      expect(await prisma.booking.count({ where: { rideId } })).toBe(0)
    }
  )
  it("отклоняет прошедшую и отсутствующую поездку", async () => {
    await prisma.ride.update({
      where: { id: rideId },
      data: { departureAt: new Date("2020-01-01") },
    })
    await send().expect(404)
    await send(undefined, 1, randomUUID()).expect(404)
  })
  it("запрещает бронирование собственной поездки", async () => {
    await send(undefined, 0).expect(403)
  })
  it("требует сессию, роль пассажира и разрешённый Origin", async () => {
    const path = `/api/rides/${rideId}/bookings`,
      body = { seats: 1, requestKey: randomUUID() }
    await request(app.getHttpServer())
      .post(path)
      .set("Origin", origin)
      .send(body)
      .expect(401)
    await send(body, 3).expect(403)
    await request(app.getHttpServer())
      .post(path)
      .set("Cookie", accounts[1]!.cookie)
      .send(body)
      .expect(403)
    await request(app.getHttpServer())
      .post(path)
      .set("Cookie", accounts[1]!.cookie)
      .set("Origin", "https://other.test")
      .send(body)
      .expect(403)
  })
  it("проверяет блокировку пассажира", async () => {
    await prisma.user.update({
      where: { id: accounts[1]!.id },
      data: { status: "BLOCKED" },
    })
    try {
      await send().expect(401)
    } finally {
      await prisma.user.update({
        where: { id: accounts[1]!.id },
        data: { status: "ACTIVE" },
      })
    }
  })
  it("проверяет блокировку и роль водителя", async () => {
    await prisma.user.update({
      where: { id: driver },
      data: { status: "BLOCKED" },
    })
    try {
      await send().expect(404)
    } finally {
      await prisma.user.update({
        where: { id: driver },
        data: { status: "ACTIVE" },
      })
    }
    await prisma.userRole.delete({
      where: { userId_role: { userId: driver, role: "DRIVER" } },
    })
    try {
      await send().expect(404)
    } finally {
      await prisma.userRole.create({ data: { userId: driver, role: "DRIVER" } })
    }
  })
  it.each([
    {},
    { seats: 0 },
    { seats: 9 },
    { seats: 1.5 },
    { seats: "1" },
    { seats: null },
    { seats: true },
    { seats: 1, requestKey: "bad" },
    { seats: 1, status: "CONFIRMED" },
    { seats: 1, unitPriceKopecks: 0 },
    { seats: 1, passengerId: randomUUID() },
  ])("отклоняет неверное тело %j", async (body) => {
    await send({ requestKey: randomUUID(), ...body }).expect(400)
  })
  it("проверяет UUID маршрута", async () => {
    await send(undefined, 1, "bad").expect(400)
  })
  it("сохраняет исходную цену и возвращает актуальный статус при повторе без нового резерва", async () => {
    const body = { seats: 2, requestKey: randomUUID() }
    const first = await send(body).expect(201)
    await prisma.booking.update({
      where: { id: first.body.id },
      data: { status: "CANCELLED" },
    })
    await prisma.ride.update({
      where: { id: rideId },
      data: { priceKopecks: 99999, status: "CANCELLED" },
    })
    const repeat = await send(body).expect(200)
    expect(repeat.body).toMatchObject({
      id: first.body.id,
      status: "CANCELLED",
      unitPriceKopecks: 15015,
    })
    expect(await prisma.booking.count({ where: { rideId } })).toBe(1)
    expect(
      await prisma.bookingStatusEvent.count({
        where: { bookingId: first.body.id },
      })
    ).toBe(1)
  })
  it("бронирует бесплатную поездку без создания платежа", async () => {
    await prisma.ride.update({
      where: { id: rideId },
      data: { priceKopecks: 0 },
    })
    const result = await send().expect(201)
    expect(result.body.unitPriceKopecks).toBe(0)
    expect(
      await prisma.payment.count({ where: { bookingId: result.body.id } })
    ).toBe(0)
  })
  it("требует ключ запроса", async () => {
    await send({ seats: 1 }).expect(400)
    await send({ seats: 1, requestKey: null }).expect(400)
  })
  it("скрывает сбой БД за безопасным 503", async () => {
    const spy = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(new Error("private database details"))
    try {
      const result = await send().expect(503)
      expect(result.body.message).toBe("Бронирование временно недоступно")
    } finally {
      spy.mockRestore()
    }
  })
})
