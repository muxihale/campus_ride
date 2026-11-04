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
import type { Prisma } from "../src/generated/prisma/client.js"
import { START_REJECTION_REASON } from "../src/rides/ride-start.service.js"
import { configureApp } from "../src/setup.js"
import type {
  BookingStatus,
  RideStatus,
} from "../src/generated/prisma/enums.js"
const domain = `${randomUUID()}.bookings.campusride.test`
const origin = "http://localhost:5173"
describe("Создание заявки и решения водителя (HTTP + PostgreSQL)", () => {
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
    await prisma.activityLog.deleteMany({
      where: { actorId: { in: accounts.map((account) => account.id) } },
    })
    await prisma.notification.deleteMany({
      where: { userId: { in: accounts.map((account) => account.id) } },
    })
    await prisma.review.deleteMany({
      where: { booking: { rideId: { in: rides } } },
    })
    await prisma.bookingStatusEvent.deleteMany({
      where: { booking: { rideId: { in: rides } } },
    })
    await prisma.payment.deleteMany({
      where: { booking: { rideId: { in: rides } } },
    })
    await prisma.booking.deleteMany({ where: { rideId: { in: rides } } })
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
        await prisma.activityLog.deleteMany({
          where: { actorId: { in: accounts.map((account) => account.id) } },
        })
        await prisma.rideStatusEvent.deleteMany({
          where: { rideId: { in: rides } },
        })
        await prisma.review.deleteMany({
          where: { booking: { rideId: { in: rides } } },
        })
        await prisma.bookingStatusEvent.deleteMany({
          where: { booking: { rideId: { in: rides } } },
        })
        await prisma.payment.deleteMany({
          where: { booking: { rideId: { in: rides } } },
        })
        await prisma.booking.deleteMany({ where: { rideId: { in: rides } } })
        await prisma.ride.deleteMany({ where: { id: { in: rides } } })
        if (driver) {
          await prisma.vehicle.deleteMany({ where: { driverId: driver } })
          await prisma.driverProfile.deleteMany({
            where: { userId: { in: accounts.map((account) => account.id) } },
          })
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
    expect(result.body).toMatchObject({
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
    ).toBe(1)
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
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 201,
    ])
    expect(results[0]!.body.id).toBe(results[1]!.body.id)
    expect(await prisma.booking.count({ where: { rideId } })).toBe(1)
  })
  it("не допускает перепродажу при одновременных запросах разных пассажиров", async () => {
    const results = await Promise.all([
      send({ seats: 2, requestKey: randomUUID() }, 1),
      send({ seats: 2, requestKey: randomUUID() }, 2),
    ])
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ])
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
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ])
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
  it("создаёт демонстрационный платёж для бесплатной поездки", async () => {
    await prisma.ride.update({
      where: { id: rideId },
      data: { priceKopecks: 0 },
    })
    const result = await send().expect(201)
    expect(result.body.unitPriceKopecks).toBe(0)
    expect(
      await prisma.payment.count({ where: { bookingId: result.body.id } })
    ).toBe(1)
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
  const pending = async (seats = 2) =>
    (await send({ seats, requestKey: randomUUID() }).expect(201)).body
      .id as string
  const decide = (
    id: string,
    action = "confirm",
    body: object = {},
    account = 0
  ) =>
    request(app.getHttpServer())
      .post(`/api/bookings/${id}/${action}`)
      .set("Origin", origin)
      .set("Cookie", accounts[account]!.cookie)
      .send(body)
  it("водитель подтверждает заявку, сохраняет резерв и фиксирует событие", async () => {
    const id = await pending()
    const result = await decide(id).expect(200)
    expect(result.headers["cache-control"]).toBe("no-store")
    expect(result.body).toMatchObject({
      id,
      rideId,
      status: "CONFIRMED",
      seats: 2,
      unitPriceKopecks: 15015,
      cancellationReason: null,
    })
    expect(
      (
        await request(app.getHttpServer())
          .get(`/api/rides/${rideId}`)
          .expect(200)
      ).body.availableSeats
    ).toBe(1)
    const events = await prisma.bookingStatusEvent.findMany({
      where: { bookingId: id, toStatus: "CONFIRMED" },
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      fromStatus: "PENDING",
      actorId: driver,
      reason: null,
    })
    expect(await prisma.payment.count({ where: { bookingId: id } })).toBe(1)
  })
  it("отклонение освобождает все места и сохраняет нормализованную причину", async () => {
    const id = await pending(3)
    await request(app.getHttpServer()).get(`/api/rides/${rideId}`).expect(404)
    const result = await decide(id, "reject", {
      reason: "  Не смогу забрать у метро  ",
    }).expect(200)
    expect(result.body).toMatchObject({
      status: "REJECTED",
      cancellationReason: "Не смогу забрать у метро",
    })
    expect(
      (
        await request(app.getHttpServer())
          .get(`/api/rides/${rideId}`)
          .expect(200)
      ).body.availableSeats
    ).toBe(3)
    expect(
      await prisma.bookingStatusEvent.findFirst({
        where: { bookingId: id, toStatus: "REJECTED" },
      })
    ).toMatchObject({
      fromStatus: "PENDING",
      actorId: driver,
      reason: "Не смогу забрать у метро",
    })
    await send({ seats: 3, requestKey: randomUUID() }).expect(201)
  })
  it.each(["confirm", "reject"])(
    "повтор %s идемпотентен, включая одновременные запросы",
    async (action) => {
      const id = await pending(),
        body = action === "reject" ? { reason: "Изменился маршрут" } : {}
      const results = await Promise.all([
        decide(id, action, body),
        decide(id, action, body),
      ])
      expect(results.map((result) => result.status)).toEqual([200, 200])
      expect(results[0]!.body).toEqual(results[1]!.body)
      expect(
        await prisma.bookingStatusEvent.count({ where: { bookingId: id } })
      ).toBe(2)
      await prisma.ride.update({
        where: { id: rideId },
        data: { status: "COMPLETED" },
      })
      await decide(id, action, body).expect(200)
      expect(
        await prisma.bookingStatusEvent.count({ where: { bookingId: id } })
      ).toBe(2)
    }
  )
  it("не меняет уже сохранённую причину отклонения", async () => {
    const id = await pending()
    await decide(id, "reject", { reason: "Изменился маршрут" }).expect(200)
    await decide(id, "reject", { reason: "Другая причина" }).expect(409)
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id } }))
        .cancellationReason
    ).toBe("Изменился маршрут")
    expect(
      await prisma.bookingStatusEvent.count({ where: { bookingId: id } })
    ).toBe(2)
  })
  it("при гонке подтверждения и отклонения принимает ровно одно решение", async () => {
    const id = await pending()
    const results = await Promise.all([
      decide(id),
      decide(id, "reject", { reason: "Изменился маршрут" }),
    ])
    expect(
      results.map((result) => result.status).sort((a, b) => a - b)
    ).toEqual([200, 409])
    const row = await prisma.booking.findUniqueOrThrow({ where: { id } })
    expect(["CONFIRMED", "REJECTED"]).toContain(row.status)
    expect(
      await prisma.bookingStatusEvent.count({ where: { bookingId: id } })
    ).toBe(2)
  })
  it("сериализует освобождение мест с новой заявкой", async () => {
    const id = await pending(3),
      body = { seats: 3, requestKey: randomUUID() }
    const [rejection, creation] = await Promise.all([
      decide(id, "reject", { reason: "Изменился маршрут" }),
      send(body, 2),
    ])
    expect(rejection.status).toBe(200)
    expect([201, 409]).toContain(creation.status)
    if (creation.status === 409) await send(body, 2).expect(201)
    expect(
      (
        await prisma.booking.aggregate({
          where: { rideId, status: { in: ["PENDING", "CONFIRMED"] } },
          _sum: { seats: true },
        })
      )._sum.seats
    ).toBe(3)
  })
  it.each(["CANCELLED", "COMPLETED"] as BookingStatus[])(
    "не принимает решения по %s",
    async (status) => {
      const id = await pending()
      await prisma.booking.update({ where: { id }, data: { status } })
      await decide(id).expect(409)
      await decide(id, "reject", { reason: "Изменился маршрут" }).expect(409)
      expect(
        await prisma.bookingStatusEvent.count({ where: { bookingId: id } })
      ).toBe(1)
    }
  )
  it("не отклоняет подтверждённую и не подтверждает отклонённую заявку", async () => {
    const id = await pending()
    await decide(id).expect(200)
    await decide(id, "reject", { reason: "Изменился маршрут" }).expect(409)
    const second = (
      await send({ seats: 1, requestKey: randomUUID() }, 2).expect(201)
    ).body.id
    await decide(second, "reject", { reason: "Изменился маршрут" }).expect(200)
    await decide(second).expect(409)
  })
  it.each(["DRAFT", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as RideStatus[])(
    "запрещает новое решение для поездки %s",
    async (status) => {
      const id = await pending()
      await prisma.ride.update({ where: { id: rideId }, data: { status } })
      await decide(id).expect(409)
      await decide(id, "reject", { reason: "Изменился маршрут" }).expect(409)
      expect(
        (await prisma.booking.findUniqueOrThrow({ where: { id } })).status
      ).toBe("PENDING")
    }
  )
  it("запрещает решение после времени отправления", async () => {
    const id = await pending()
    await prisma.ride.update({
      where: { id: rideId },
      data: { departureAt: new Date("2020-01-01") },
    })
    await decide(id).expect(409)
    await decide(id, "reject", { reason: "Изменился маршрут" }).expect(409)
  })
  it.each(["confirm", "reject"])(
    "проверяет сессию, роль, Origin и владение для %s",
    async (action) => {
      const id = await pending(),
        body = action === "reject" ? { reason: "Изменился маршрут" } : {},
        path = `/api/bookings/${id}/${action}`
      await request(app.getHttpServer())
        .post(path)
        .set("Origin", origin)
        .send(body)
        .expect(401)
      await decide(id, action, body, 1).expect(403)
      await decide(id, action, body, 3).expect(403)
      await request(app.getHttpServer())
        .post(path)
        .set("Cookie", accounts[0]!.cookie)
        .send(body)
        .expect(403)
      await request(app.getHttpServer())
        .post(path)
        .set("Cookie", accounts[0]!.cookie)
        .set("Origin", "https://other.test")
        .send(body)
        .expect(403)
      await prisma.userRole.create({
        data: { userId: accounts[2]!.id, role: "DRIVER" },
      })
      try {
        await decide(id, action, body, 2).expect(404)
      } finally {
        await prisma.userRole.delete({
          where: { userId_role: { userId: accounts[2]!.id, role: "DRIVER" } },
        })
      }
      await decide(randomUUID(), action, body).expect(404)
      await decide("bad", action, body).expect(400)
      expect(
        (await prisma.booking.findUniqueOrThrow({ where: { id } })).status
      ).toBe("PENDING")
    }
  )
  it("учитывает блокировку и отзыв роли водителя", async () => {
    const id = await pending()
    await prisma.user.update({
      where: { id: driver },
      data: { status: "BLOCKED" },
    })
    try {
      await decide(id).expect(401)
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
      await decide(id).expect(403)
    } finally {
      await prisma.userRole.create({ data: { userId: driver, role: "DRIVER" } })
    }
  })
  it.each([
    {},
    { reason: "" },
    { reason: "   " },
    { reason: null },
    { reason: 42 },
    { reason: "x".repeat(501) },
    { reason: "Причина", status: "CONFIRMED" },
  ])("проверяет причину отклонения %j", async (body) => {
    const id = await pending()
    await decide(id, "reject", body).expect(400)
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id } })).status
    ).toBe("PENDING")
  })
  it("подтверждение не принимает поля клиента и допускает пустое тело", async () => {
    const id = await pending()
    await decide(id, "confirm", { status: "CONFIRMED" }).expect(400)
    await request(app.getHttpServer())
      .post(`/api/bookings/${id}/confirm`)
      .set("Origin", origin)
      .set("Cookie", accounts[0]!.cookie)
      .expect(200)
  })
  it("безопасно обрабатывает сбой транзакции решения", async () => {
    const id = await pending(),
      spy = vi
        .spyOn(prisma, "$transaction")
        .mockRejectedValueOnce(new Error("private database details"))
    try {
      const result = await decide(id).expect(503)
      expect(result.body.message).toBe("Решение по заявке временно недоступно")
    } finally {
      spy.mockRestore()
    }
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id } })).status
    ).toBe("PENDING")
    expect(
      await prisma.bookingStatusEvent.count({ where: { bookingId: id } })
    ).toBe(1)
  })
  async function listFixture() {
    const upcomingId = await pending(2)
    const rejected = await prisma.booking.create({
      data: {
        rideId,
        passengerId: accounts[1]!.id,
        requestKey: randomUUID(),
        seats: 1,
        unitPriceKopecks: 5000,
        status: "REJECTED",
        cancellationReason: "Не по пути",
      },
    })
    const past = await prisma.ride.create({
      data: {
        driverId: driver,
        vehicleId: vehicle,
        originId: start,
        destinationId: finish,
        departureAt: new Date("2020-11-09T03:00:00Z"),
        seatsTotal: 3,
        priceKopecks: 9900,
        status: "COMPLETED",
      },
    })
    rides.push(past.id)
    const completed = await prisma.booking.create({
      data: {
        rideId: past.id,
        passengerId: accounts[1]!.id,
        requestKey: randomUUID(),
        seats: 3,
        unitPriceKopecks: 0,
        status: "COMPLETED",
      },
    })
    await prisma.booking.create({
      data: {
        rideId,
        passengerId: accounts[2]!.id,
        requestKey: randomUUID(),
        seats: 1,
        unitPriceKopecks: 15015,
      },
    })
    return { upcomingId, rejected: rejected.id, completed: completed.id }
  }
  const list = (query = "", account = 1) =>
    request(app.getHttpServer())
      .get(`/api/me/bookings${query ? `?${query}` : ""}`)
      .set("Cookie", accounts[account]!.cookie)
  it("список содержит только свои заявки, безопасные данные поездки и исходную цену", async () => {
    const rows = await listFixture(),
      result = await list().expect(200)
    expect(result.headers["cache-control"]).toBe("no-store")
    expect(result.body).toMatchObject({ total: 3, page: 1, pageSize: 20 })
    expect(
      result.body.items
        .map((item: { id: string }) => item.id)
        .sort((a: string, b: string) => a.localeCompare(b))
    ).toEqual(
      Object.values(rows).sort((a: string, b: string) => a.localeCompare(b))
    )
    const past = result.body.items.find(
      (item: { id: string }) => item.id === rows.completed
    )
    expect(past).toMatchObject({
      unitPriceKopecks: 0,
      status: "COMPLETED",
      ride: {
        status: "COMPLETED",
        origin: { name: "Уралмаш" },
        destination: { name: "УрФУ" },
        driver: { id: driver, fullName: "Анна Соколова" },
      },
    })
    for (const field of [
      "passwordHash",
      "phone",
      "registrationNumber",
      "tokenHash",
      "email",
    ])
      expect(JSON.stringify(result.body)).not.toContain(`"${field}"`)
    expect((await list("", 2).expect(200)).body.total).toBe(1)
  })
  it("разделяет предстоящие поездки и историю без потери заявок", async () => {
    const rows = await listFixture()
    expect(
      (await list("period=upcoming").expect(200)).body.items.map(
        (item: { id: string }) => item.id
      )
    ).toEqual([rows.upcomingId])
    expect((await list("period=history").expect(200)).body.total).toBe(2)
    await prisma.ride.update({
      where: { id: rideId },
      data: { status: "CANCELLED" },
    })
    expect((await list("period=upcoming").expect(200)).body.total).toBe(0)
    expect((await list("period=history").expect(200)).body.total).toBe(3)
  })
  it("объединяет фильтры статуса, поездки, мест, цены и времени через И", async () => {
    const rows = await listFixture()
    const result = await list(
      "status=PENDING&rideStatus=PUBLISHED&minSeats=2&maxPriceKopecks=15015&departureFrom=2099-11-09T08%3A00%3A00%2B05%3A00&departureTo=2099-11-09T08%3A00%3A00%2B05%3A00"
    ).expect(200)
    expect(result.body.items.map((item: { id: string }) => item.id)).toEqual([
      rows.upcomingId,
    ])
    expect(
      (await list("status=PENDING&maxPriceKopecks=0").expect(200)).body.total
    ).toBe(0)
    expect((await list("maxPriceKopecks=0").expect(200)).body.items[0].id).toBe(
      rows.completed
    )
  })
  it.each(["уралмаш", "мира", "соколова", "kia", "rio", "Не по пути"])(
    "ищет свои заявки по %s",
    async (q) => {
      await listFixture()
      const result = await list(`q=${encodeURIComponent(q)}`).expect(200)
      expect(result.body.total).toBe(q === "Не по пути" ? 1 : 3)
    }
  )
  it("стабильно сортирует и считает total до пагинации", async () => {
    const rows = await listFixture(),
      ids: string[] = []
    for (let page = 1; page <= 3; page++) {
      const result = await list(
        `pageSize=1&page=${page}&sort=departureAsc`
      ).expect(200)
      expect(result.body.total).toBe(3)
      ids.push(result.body.items[0].id)
    }
    expect(new Set(ids).size).toBe(3)
    expect(ids[0]).toBe(rows.completed)
    expect(
      (await list("pageSize=1&sort=departureDesc").expect(200)).body.items[0].id
    ).not.toBe(rows.completed)
    const empty = await list("page=99&pageSize=1").expect(200)
    expect(empty.body).toMatchObject({
      items: [],
      total: 3,
      page: 99,
      pageSize: 1,
    })
  })
  it.each([
    "status=INVALID",
    "rideStatus=INVALID",
    "period=INVALID",
    "page=0",
    "pageSize=101",
    "minSeats=9",
    "minSeats=1.5",
    "maxPriceKopecks=-1",
    "departureFrom=bad",
    "departureFrom=2099-11-09T08:00:00",
    "departureFrom=2099-11-10T00:00:00Z&departureTo=2099-11-09T00:00:00Z",
    "sort=bad",
    "passengerId=bad",
    "q=" + "x".repeat(101),
  ])("проверяет параметры списка %s", async (query) => {
    await list(query).expect(400)
  })
  it("защищает список сессией и ролью пассажира", async () => {
    await request(app.getHttpServer()).get("/api/me/bookings").expect(401)
    await list("", 3).expect(403)
    const empty = await list().expect(200)
    expect(empty.body.total).toBe(0)
  })
  it("возвращает безопасный 503 при ошибке чтения списка", async () => {
    const spy = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(new Error("private DB details"))
    try {
      const result = await list().expect(503)
      expect(result.body.message).toBe("Заявки временно недоступны")
    } finally {
      spy.mockRestore()
    }
  })
  const driverList = (query = "", account = 0) =>
    request(app.getHttpServer())
      .get(`/api/me/ride-bookings${query ? `?${query}` : ""}`)
      .set("Cookie", accounts[account]!.cookie)
  it("водитель видит заявки только своих поездок, пассажиров и остаток без ключей и контактов", async () => {
    await listFixture()
    const result = await driverList().expect(200)
    expect(result.headers["cache-control"]).toBe("no-store")
    expect(result.body.total).toBe(4)
    expect(
      result.body.items.find(
        (item: { rideId: string }) => item.rideId === rideId
      )
    ).toMatchObject({
      passenger: { id: expect.any(String), fullName: "Анна Соколова" },
      ride: { availableSeats: 0 },
    })
    for (const field of [
      "requestKey",
      "passwordHash",
      "phone",
      "email",
      "registrationNumber",
      "bookings",
      "tokenHash",
    ])
      expect(JSON.stringify(result.body)).not.toContain(`"${field}"`)
    await prisma.userRole.create({
      data: { userId: accounts[2]!.id, role: "DRIVER" },
    })
    try {
      expect((await driverList("", 2).expect(200)).body).toMatchObject({
        items: [],
        total: 0,
      })
    } finally {
      await prisma.userRole.delete({
        where: { userId_role: { userId: accounts[2]!.id, role: "DRIVER" } },
      })
    }
  })
  it("фильтрует заявки водителя по поездке, статусам, времени, местам и цене", async () => {
    await listFixture()
    const result = await driverList(
      `rideId=${rideId}&status=PENDING&rideStatus=PUBLISHED&minSeats=2&maxPriceKopecks=15015&period=upcoming&departureFrom=2099-11-09T03:00:00Z&departureTo=2099-11-09T03:00:00Z`
    ).expect(200)
    expect(result.body.total).toBe(1)
    expect(result.body.items[0].seats).toBe(2)
    expect(
      (await driverList(`rideId=${randomUUID()}`).expect(200)).body.total
    ).toBe(0)
    expect((await driverList("period=history").expect(200)).body.total).toBe(2)
    expect((await driverList("maxPriceKopecks=0").expect(200)).body.total).toBe(
      1
    )
  })
  it("ищет пассажиров по имени и принадлежности к университету", async () => {
    await listFixture()
    await prisma.user.update({
      where: { id: accounts[1]!.id },
      data: { fullName: "Мария Лебедева", affiliation: "ИРИТ-РТФ" },
    })
    try {
      for (const q of ["лебедева", "ИРИТ-РТФ"])
        expect(
          (await driverList(`q=${encodeURIComponent(q)}`).expect(200)).body
            .total
        ).toBe(3)
      expect(
        (await driverList(`q=${encodeURIComponent("Не по пути")}`).expect(200))
          .body.total
      ).toBe(1)
    } finally {
      await prisma.user.update({
        where: { id: accounts[1]!.id },
        data: { fullName: "Анна Соколова", affiliation: null },
      })
    }
  })
  it("список водителя отражает решение и освободившиеся места", async () => {
    const id = await pending(2)
    expect(
      (await driverList("status=PENDING").expect(200)).body.items[0].ride
        .availableSeats
    ).toBe(1)
    await decide(id, "reject", { reason: "Изменился маршрут" }).expect(200)
    expect((await driverList("status=PENDING").expect(200)).body.total).toBe(0)
    const result = await driverList("status=REJECTED").expect(200)
    expect(result.body.items[0]).toMatchObject({
      cancellationReason: "Изменился маршрут",
      ride: { availableSeats: 3 },
    })
  })
  it("сортирует и разбивает заявки водителя на стабильные страницы", async () => {
    await listFixture()
    const ids: string[] = []
    for (let page = 1; page <= 4; page++) {
      const result = await driverList(
        `page=${page}&pageSize=1&sort=createdDesc`
      ).expect(200)
      expect(result.body.total).toBe(4)
      ids.push(result.body.items[0].id)
    }
    expect(new Set(ids).size).toBe(4)
    expect((await driverList("page=99").expect(200)).body).toMatchObject({
      items: [],
      total: 4,
    })
  })
  it.each([
    "rideId=bad",
    "driverId=bad",
    "passengerId=bad",
    "status=BAD",
    "rideStatus=BAD",
    "period=BAD",
    "page=0",
    "pageSize=101",
    "minSeats=9",
    "maxPriceKopecks=-1",
    "sort=BAD",
    "departureFrom=2099-11-10T00:00:00Z&departureTo=2099-11-09T00:00:00Z",
  ])("проверяет параметры списка водителя %s", async (query) => {
    await driverList(query).expect(400)
  })
  it("защищает список водителя ролью и сессией", async () => {
    await request(app.getHttpServer()).get("/api/me/ride-bookings").expect(401)
    await driverList("", 1).expect(403)
    await driverList("", 3).expect(403)
  })
  it("скрывает сбой списка водителя за безопасным 503", async () => {
    const spy = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(new Error("private details"))
    try {
      expect((await driverList().expect(503)).body.message).toBe(
        "Заявки временно недоступны"
      )
    } finally {
      spy.mockRestore()
    }
  })
  const notifications = (query = "", account = 1) =>
    request(app.getHttpServer())
      .get(`/api/notifications${query ? `?${query}` : ""}`)
      .set("Cookie", accounts[account]!.cookie)
  it("полный сценарий: поиск → карточка → заявка → уведомление водителю → подтверждение → кабинет пассажира", async () => {
    await prisma.ride.update({
      where: { id: rideId },
      data: { conditions: `Поездка ${rideId}` },
    })
    const found = await request(app.getHttpServer())
      .get(
        `/api/rides?q=${rideId}&originDistrictId=${district}&date=2099-11-09&timeFrom=08:00&timeTo=09:00`
      )
      .expect(200)
    expect(
      found.body.items.some((ride: { id: string }) => ride.id === rideId)
    ).toBe(true)
    expect(
      (
        await request(app.getHttpServer())
          .get(`/api/rides/${rideId}`)
          .expect(200)
      ).body.availableSeats
    ).toBe(3)
    const body = { seats: 2, requestKey: randomUUID() }
    const created = await send(body).expect(201),
      id = created.body.id
    await send(body).expect(200)
    const inbox = await notifications("kind=BOOKING_REQUEST", 0).expect(200)
    expect(inbox.body.total).toBe(1)
    expect(inbox.body.items[0]).toMatchObject({
      resourceType: "booking",
      resourceId: id,
      link: "#/ride-bookings",
      readAt: null,
    })
    expect(
      (await driverList("status=PENDING").expect(200)).body.items[0].id
    ).toBe(id)
    await decide(id).expect(200)
    await decide(id).expect(200)
    const upcoming = await list("period=upcoming&status=CONFIRMED").expect(200)
    expect(upcoming.body.items[0]).toMatchObject({
      id,
      seats: 2,
      status: "CONFIRMED",
      unitPriceKopecks: 15015,
    })
    const passengerInbox = await notifications("kind=BOOKING_CONFIRMED").expect(
      200
    )
    expect(passengerInbox.body.total).toBe(1)
    expect(passengerInbox.body.items[0]).toMatchObject({
      resourceId: id,
      link: "#/bookings",
    })
    expect(
      (
        await request(app.getHttpServer())
          .get(`/api/rides/${rideId}`)
          .expect(200)
      ).body.availableSeats
    ).toBe(1)
    expect(await prisma.payment.count({ where: { bookingId: id } })).toBe(1)
  })
  it("уведомляет пассажира об отклонении с причиной без дублей", async () => {
    const id = await pending(),
      body = { reason: "Изменился маршрут" }
    await decide(id, "reject", body).expect(200)
    await decide(id, "reject", body).expect(200)
    const inbox = await notifications("kind=BOOKING_REJECTED").expect(200)
    expect(inbox.body.total).toBe(1)
    expect(inbox.body.items[0].body).toContain(body.reason)
    expect(inbox.body.items[0].resourceId).toBe(id)
  })
  const failNotificationWrite = (failAt = 1) => {
    let writes = 0
    const original = prisma.$transaction.bind(prisma)
    return vi.spyOn(prisma, "$transaction").mockImplementationOnce(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>
    ) =>
      original(async (tx) => {
        const proxy = new Proxy(tx, {
          get(target, property, receiver) {
            if (property === "notification")
              return {
                ...target.notification,
                create: async (args: Prisma.NotificationCreateArgs) => {
                  if (++writes === failAt)
                    throw new Error("notification insert failed")
                  return target.notification.create(args)
                },
              }
            return Reflect.get(target, property, receiver)
          },
        })
        return callback(proxy)
      })) as typeof prisma.$transaction)
  }
  it("откатывает заявку, резерв и событие при ошибке записи уведомления", async () => {
    const spy = failNotificationWrite()
    try {
      await send().expect(503)
    } finally {
      spy.mockRestore()
    }
    expect(await prisma.booking.count({ where: { rideId } })).toBe(0)
    expect(
      await prisma.bookingStatusEvent.count({ where: { booking: { rideId } } })
    ).toBe(0)
    expect(
      (
        await request(app.getHttpServer())
          .get(`/api/rides/${rideId}`)
          .expect(200)
      ).body.availableSeats
    ).toBe(3)
  })
  it("откатывает решение и событие при ошибке уведомления пассажира", async () => {
    const id = await pending(),
      spy = failNotificationWrite()
    try {
      await decide(id).expect(503)
    } finally {
      spy.mockRestore()
    }
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id } })).status
    ).toBe("PENDING")
    expect(
      await prisma.bookingStatusEvent.count({ where: { bookingId: id } })
    ).toBe(1)
    expect(
      (await notifications("kind=BOOKING_CONFIRMED").expect(200)).body.total
    ).toBe(0)
  })
  async function inboxFixture() {
    const rows = await prisma.notification.createManyAndReturn({
      data: [
        {
          userId: accounts[1]!.id,
          kind: "BOOKING_CONFIRMED",
          title: "Заявка подтверждена",
          body: "Уралмаш → УрФУ",
          link: "#/bookings",
          resourceType: "booking",
          createdAt: new Date("2026-10-31T03:00:00Z"),
        },
        {
          userId: accounts[1]!.id,
          kind: "SYSTEM",
          title: "Профиль",
          body: "Настройки обновлены",
          resourceType: "user",
          readAt: new Date(),
          createdAt: new Date("2026-10-30T03:00:00Z"),
        },
        {
          userId: accounts[2]!.id,
          kind: "SYSTEM",
          title: "Чужое",
          body: "Личное",
        },
      ],
    })
    return rows
  }
  it("фильтрует только свои уведомления и считает total до пагинации", async () => {
    await inboxFixture()
    const all = await notifications("pageSize=1").expect(200)
    expect(all.body.total).toBe(2)
    expect(all.body.items).toHaveLength(1)
    const filtered = await notifications(
      `q=${encodeURIComponent("уралмаш")}&kind=BOOKING_CONFIRMED&read=false&resourceType=booking&dateFrom=2026-10-31T08%3A00%3A00%2B05%3A00&dateTo=2026-10-31T08%3A00%3A00%2B05%3A00`
    ).expect(200)
    expect(filtered.body.total).toBe(1)
    expect(filtered.body.items[0].title).toBe("Заявка подтверждена")
    expect((await notifications("read=true").expect(200)).body.total).toBe(1)
    expect((await notifications("page=99").expect(200)).body).toMatchObject({
      items: [],
      total: 2,
    })
    expect(JSON.stringify(all.body)).not.toContain('"userId"')
  })
  it("помечает своё уведомление прочитанным идемпотентно и не меняет чужое", async () => {
    const rows = await inboxFixture(),
      own = rows.find(
        (row) => row.userId === accounts[1]!.id && row.readAt === null
      )!,
      other = rows.find((row) => row.userId === accounts[2]!.id)!
    const read = (id: string) =>
      request(app.getHttpServer())
        .patch(`/api/notifications/${id}/read`)
        .set("Cookie", accounts[1]!.cookie)
        .set("Origin", origin)
        .send({})
    const [first, second] = await Promise.all([read(own.id), read(own.id)])
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(first.body.readAt).toBe(second.body.readAt)
    await read(other.id).expect(404)
    await read(randomUUID()).expect(404)
    await read("bad").expect(400)
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: other.id } }))
        .readAt
    ).toBeNull()
  })
  it("защищает чтение сессией и изменение Origin, поддерживает все три роли", async () => {
    const rows = await inboxFixture(),
      id = rows[0]!.id
    await request(app.getHttpServer()).get("/api/notifications").expect(401)
    for (const account of [0, 1, 3])
      await notifications("", account).expect(200)
    await request(app.getHttpServer())
      .patch(`/api/notifications/${id}/read`)
      .set("Cookie", accounts[1]!.cookie)
      .send({})
      .expect(403)
    await request(app.getHttpServer())
      .patch(`/api/notifications/${id}/read`)
      .set("Cookie", accounts[1]!.cookie)
      .set("Origin", origin)
      .send({ readAt: "2020-01-01" })
      .expect(400)
  })
  it.each([
    "kind=BAD",
    "read=1",
    "resourceType=BAD",
    "page=0",
    "pageSize=101",
    "dateFrom=bad",
    "dateFrom=2026-10-31T03:00:00",
    "dateFrom=2026-11-01T00:00:00Z&dateTo=2026-10-31T00:00:00Z",
    "userId=bad",
  ])("проверяет параметры уведомлений %s", async (query) => {
    await notifications(query).expect(400)
  })
  const cancel = (id: string, body: object = {}, account = 1) =>
    request(app.getHttpServer())
      .post(`/api/bookings/${id}/cancel`)
      .set("Origin", origin)
      .set("Cookie", accounts[account]!.cookie)
      .send(body)
  const cancelRide = (
    body: object = { reason: "Автомобиль в ремонте" },
    account = 0,
    id = rideId
  ) =>
    request(app.getHttpServer())
      .post(`/api/rides/${id}/cancel`)
      .set("Origin", origin)
      .set("Cookie", accounts[account]!.cookie)
      .send(body)
  it("создаёт ожидающий платёж, подтверждает демо-оплату и сохраняет её при повторе", async () => {
    const id = await pending(2)
    expect(
      await prisma.payment.findUnique({ where: { bookingId: id } })
    ).toMatchObject({
      amountKopecks: 30030n,
      status: "PENDING",
      isDemo: true,
      paidAt: null,
      refundedAt: null,
    })
    const first = await decide(id).expect(200),
      repeated = await decide(id).expect(200)
    expect(first.body.payment).toMatchObject({
      amountKopecks: 30030,
      status: "SUCCEEDED",
      isDemo: true,
      paidAt: expect.any(String),
      refundedAt: null,
    })
    expect(repeated.body.payment).toEqual(first.body.payment)
    expect(
      await prisma.activityLog.count({
        where: {
          action: "payment.succeeded",
          resourceId: first.body.payment.id,
        },
      })
    ).toBe(1)
  })
  it("проводит бесплатный платёж на нулевую сумму и полный нулевой возврат", async () => {
    await prisma.ride.update({
      where: { id: rideId },
      data: { priceKopecks: 0 },
    })
    const id = await pending()
    expect((await decide(id).expect(200)).body.payment).toMatchObject({
      amountKopecks: 0,
      status: "SUCCEEDED",
    })
    expect((await cancel(id).expect(200)).body.payment).toMatchObject({
      amountKopecks: 0,
      status: "REFUNDED",
      refundedAt: expect.any(String),
    })
  })
  it("поддерживает сумму восьми мест по максимальной цене без переполнения и BigInt в JSON", async () => {
    await prisma.ride.update({
      where: { id: rideId },
      data: { seatsTotal: 8, priceKopecks: 2147483647 },
    })
    const id = await pending(8)
    expect((await decide(id).expect(200)).body.payment.amountKopecks).toBe(
      17179869176
    )
    expect((await list().expect(200)).body.items[0].payment.amountKopecks).toBe(
      17179869176
    )
    expect(
      (await driverList().expect(200)).body.items[0].payment.amountKopecks
    ).toBe(17179869176)
    expect((await cancel(id).expect(200)).body.payment).toMatchObject({
      amountKopecks: 17179869176,
      status: "REFUNDED",
    })
  })
  it("пассажир отменяет ожидающую заявку без списания и освобождает места", async () => {
    const id = await pending(3),
      result = await cancel(id, { reason: "  Изменились планы  " }).expect(200)
    expect(result.body).toMatchObject({
      status: "CANCELLED",
      cancellationReason: "Изменились планы",
      payment: { status: "CANCELLED", paidAt: null, refundedAt: null },
    })
    expect(
      (
        await request(app.getHttpServer())
          .get(`/api/rides/${rideId}`)
          .expect(200)
      ).body.availableSeats
    ).toBe(3)
    expect(
      await prisma.bookingStatusEvent.findFirst({
        where: { bookingId: id, toStatus: "CANCELLED" },
      })
    ).toMatchObject({
      actorId: accounts[1]!.id,
      fromStatus: "PENDING",
      reason: "Изменились планы",
    })
    expect(
      (await notifications("kind=BOOKING_CANCELLED", 0).expect(200)).body.total
    ).toBe(1)
    await send({ seats: 3, requestKey: randomUUID() }).expect(201)
  })
  it("полностью возвращает подтверждённую оплату один раз при параллельных отменах", async () => {
    const id = await pending()
    const confirmed = await decide(id).expect(200)
    const results = await Promise.all([cancel(id), cancel(id)])
    expect(results.map((result) => result.status)).toEqual([200, 200])
    expect(results[0]!.body.payment).toEqual(results[1]!.body.payment)
    expect(results[0]!.body.payment).toMatchObject({
      status: "REFUNDED",
      amountKopecks: 30030,
      paidAt: confirmed.body.payment.paidAt,
    })
    expect(
      await prisma.activityLog.count({
        where: {
          action: "payment.refunded",
          resourceId: confirmed.body.payment.id,
        },
      })
    ).toBe(1)
    expect(
      await prisma.bookingStatusEvent.count({
        where: { bookingId: id, toStatus: "CANCELLED" },
      })
    ).toBe(1)
    await prisma.ride.update({
      where: { id: rideId },
      data: { departureAt: new Date("2020-01-01") },
    })
    await cancel(id, { reason: "Другая причина" }).expect(200)
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id } }))
        .cancellationReason
    ).toBeNull()
  })
  it("отклонение водителем отменяет ожидающий платёж без возврата", async () => {
    const id = await pending()
    const result = await decide(id, "reject", {
      reason: "Изменился маршрут",
    }).expect(200)
    expect(result.body.payment).toMatchObject({
      status: "CANCELLED",
      paidAt: null,
      refundedAt: null,
    })
  })
  it.each(["REJECTED", "COMPLETED"] as BookingStatus[])(
    "не отменяет конечную заявку %s",
    async (status) => {
      const id = await pending()
      await prisma.booking.update({ where: { id }, data: { status } })
      await cancel(id).expect(409)
    }
  )
  it.each(["DRAFT", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as RideStatus[])(
    "не отменяет заявку при статусе поездки %s",
    async (status) => {
      const id = await pending()
      await prisma.ride.update({ where: { id: rideId }, data: { status } })
      await cancel(id).expect(409)
    }
  )
  it("не отменяет заявку после отправления или начатую поездку с рассогласованным статусом", async () => {
    const id = await pending()
    await prisma.ride.update({
      where: { id: rideId },
      data: { departureAt: new Date("2020-01-01") },
    })
    await cancel(id).expect(409)
    await prisma.ride.update({
      where: { id: rideId },
      data: { departureAt: new Date("2099-11-09"), startedAt: new Date() },
    })
    await cancel(id).expect(409)
  })
  it("защищает отмену заявки владельцем, ролью, сессией и Origin", async () => {
    const id = await pending(),
      path = `/api/bookings/${id}/cancel`
    await cancel(id, {}, 2).expect(404)
    await cancel(id, {}, 0).expect(404)
    await cancel(id, {}, 3).expect(403)
    await cancel(randomUUID()).expect(404)
    await cancel("bad").expect(400)
    await request(app.getHttpServer())
      .post(path)
      .set("Origin", origin)
      .send({})
      .expect(401)
    await request(app.getHttpServer())
      .post(path)
      .set("Cookie", accounts[1]!.cookie)
      .send({})
      .expect(403)
    await cancel(id, { reason: null }).expect(400)
    await cancel(id, { reason: " " }).expect(400)
    await cancel(id, { reason: "x".repeat(501) }).expect(400)
    await cancel(id, { amountKopecks: 0 }).expect(400)
  })
  it("гонка подтверждения и отмены не оставляет активную заявку или успешную невозвращённую оплату", async () => {
    const id = await pending(),
      results = await Promise.all([decide(id), cancel(id)])
    expect(results[1]!.status).toBe(200)
    expect([200, 409]).toContain(results[0]!.status)
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { bookingId: id },
    })
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id } })).status
    ).toBe("CANCELLED")
    expect(["CANCELLED", "REFUNDED"]).toContain(payment.status)
  })
  it("гонка отмены и нового бронирования не перепродаёт освобождённые места", async () => {
    const id = await pending(3),
      body = { seats: 3, requestKey: randomUUID() }
    const results = await Promise.all([cancel(id), send(body, 2)])
    expect(results[0]!.status).toBe(200)
    expect([201, 409]).toContain(results[1]!.status)
    if (results[1]!.status === 409) await send(body, 2).expect(201)
    expect(
      (
        await prisma.booking.aggregate({
          where: { rideId, status: { in: ["PENDING", "CONFIRMED"] } },
          _sum: { seats: true },
        })
      )._sum.seats
    ).toBe(3)
  })
  it("отмена поездки возвращает оплаты подтверждённых заявок и отменяет ожидающие", async () => {
    const id = await pending(2)
    await decide(id).expect(200)
    const second = (
      await send({ seats: 1, requestKey: randomUUID() }, 2).expect(201)
    ).body.id
    const result = await cancelRide().expect(200)
    expect(result.body).toMatchObject({
      id: rideId,
      status: "CANCELLED",
      cancellationReason: "Автомобиль в ремонте",
    })
    expect(
      await prisma.booking.findMany({
        where: { rideId },
        select: { status: true },
      })
    ).toEqual([{ status: "CANCELLED" }, { status: "CANCELLED" }])
    expect(
      await prisma.payment.findUnique({ where: { bookingId: id } })
    ).toMatchObject({ status: "REFUNDED", amountKopecks: 30030n })
    expect(
      await prisma.payment.findUnique({ where: { bookingId: second } })
    ).toMatchObject({ status: "CANCELLED", paidAt: null })
    await request(app.getHttpServer()).get(`/api/rides/${rideId}`).expect(404)
    expect(
      (await notifications("kind=RIDE_CANCELLED").expect(200)).body.total
    ).toBe(1)
    expect(
      (await notifications("kind=RIDE_CANCELLED", 2).expect(200)).body.total
    ).toBe(1)
    expect(
      await prisma.rideStatusEvent.count({
        where: { rideId, toStatus: "CANCELLED" },
      })
    ).toBe(1)
    const count = await prisma.notification.count({
      where: { userId: { in: accounts.map((account) => account.id) } },
    })
    await cancelRide().expect(200)
    expect(
      await prisma.notification.count({
        where: { userId: { in: accounts.map((account) => account.id) } },
      })
    ).toBe(count)
    await cancelRide({ reason: "Другая причина" }).expect(409)
  })
  it("отменяет пустой черновик и просроченную опубликованную поездку", async () => {
    await prisma.ride.update({
      where: { id: rideId },
      data: { status: "DRAFT" },
    })
    await cancelRide().expect(200)
    await prisma.ride.update({
      where: { id: rideId },
      data: { status: "PUBLISHED", departureAt: new Date("2020-01-01") },
    })
    await cancelRide().expect(200)
  })
  it.each(["IN_PROGRESS", "COMPLETED"] as RideStatus[])(
    "не отменяет поездку %s",
    async (status) => {
      await prisma.ride.update({ where: { id: rideId }, data: { status } })
      await cancelRide().expect(409)
    }
  )
  it("защищает отмену поездки владельцем и валидирует причину", async () => {
    await cancelRide({}, 0).expect(400)
    await cancelRide({ reason: " " }).expect(400)
    await cancelRide({ reason: "x".repeat(501) }).expect(400)
    await cancelRide(undefined, 1).expect(403)
    await cancelRide(undefined, 3).expect(403)
    await cancelRide(undefined, 0, randomUUID()).expect(404)
    await prisma.userRole.create({
      data: { userId: accounts[2]!.id, role: "DRIVER" },
    })
    try {
      await cancelRide(undefined, 2).expect(404)
    } finally {
      await prisma.userRole.delete({
        where: { userId_role: { userId: accounts[2]!.id, role: "DRIVER" } },
      })
    }
    await request(app.getHttpServer())
      .post(`/api/rides/${rideId}/cancel`)
      .set("Cookie", accounts[0]!.cookie)
      .send({ reason: "Причина" })
      .expect(403)
  })
  it("откатывает возврат, отмену и историю при сбое уведомления", async () => {
    const id = await pending()
    await decide(id).expect(200)
    const before = await prisma.activityLog.count({
        where: { actorId: { in: accounts.map((account) => account.id) } },
      }),
      spy = failNotificationWrite()
    try {
      await cancel(id).expect(503)
    } finally {
      spy.mockRestore()
    }
    expect(
      await prisma.payment.findUnique({ where: { bookingId: id } })
    ).toMatchObject({ status: "SUCCEEDED", refundedAt: null })
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id } })).status
    ).toBe("CONFIRMED")
    expect(
      await prisma.activityLog.count({
        where: { actorId: { in: accounts.map((account) => account.id) } },
      })
    ).toBe(before)
  })
  it("откатывает всю поездку и ранее обработанную заявку при сбое второго возврата", async () => {
    const id = await pending(2)
    await decide(id).expect(200)
    const second = (
      await send({ seats: 1, requestKey: randomUUID() }, 2).expect(201)
    ).body.id
    await decide(second).expect(200)
    const spy = failNotificationWrite(3)
    try {
      await cancelRide().expect(503)
    } finally {
      spy.mockRestore()
    }
    expect(
      (await prisma.ride.findUniqueOrThrow({ where: { id: rideId } })).status
    ).toBe("PUBLISHED")
    for (const bookingId of [id, second]) {
      expect(
        (await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } }))
          .status
      ).toBe("CONFIRMED")
      expect(
        await prisma.payment.findUnique({ where: { bookingId } })
      ).toMatchObject({ status: "SUCCEEDED", refundedAt: null })
    }
  })
  it("гонка отмены поездки с подтверждением не оставляет успешный платёж", async () => {
    const id = await pending(),
      results = await Promise.all([cancelRide(), decide(id)])
    expect(results[0]!.status).toBe(200)
    expect([200, 409]).toContain(results[1]!.status)
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id } })).status
    ).toBe("CANCELLED")
    expect(["CANCELLED", "REFUNDED"]).toContain(
      (await prisma.payment.findUniqueOrThrow({ where: { bookingId: id } }))
        .status
    )
  })
  const startRide = (id = rideId, account = 0, body: object = {}) =>
    request(app.getHttpServer())
      .post(`/api/rides/${id}/start`)
      .set("Cookie", accounts[account]!.cookie)
      .set("Origin", origin)
      .send(body)
  it("водитель начинает свою поездку, фиксирует серверное время и событие, повтор не меняет результат", async () => {
    const before = Date.now(),
      first = await startRide().expect(200)
    expect(first.headers["cache-control"]).toBe("no-store")
    expect(first.body).toEqual({
      id: rideId,
      status: "IN_PROGRESS",
      startedAt: expect.any(String),
    })
    expect(new Date(first.body.startedAt).getTime()).toBeGreaterThanOrEqual(
      before
    )
    expect(new Date(first.body.startedAt).getTime()).toBeLessThanOrEqual(
      Date.now()
    )
    const second = await startRide().expect(200)
    expect(second.body).toEqual(first.body)
    const events = await prisma.rideStatusEvent.findMany({
      where: { rideId, toStatus: "IN_PROGRESS" },
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      fromStatus: "PUBLISHED",
      actorId: driver,
      reason: null,
    })
    const own = await request(app.getHttpServer())
      .get(`/api/me/rides/${rideId}`)
      .set("Cookie", accounts[0]!.cookie)
      .expect(200)
    expect(own.body.startedAt).toBe(first.body.startedAt)
    expect(
      (await prisma.ride.findUniqueOrThrow({ where: { id: rideId } }))
        .completedAt
    ).toBeNull()
  })
  it("параллельные старты возвращают одно время и одно событие", async () => {
    const results = await Promise.all([startRide(), startRide()])
    expect(results.map((result) => result.status)).toEqual([200, 200])
    expect(results[0]!.body).toEqual(results[1]!.body)
    expect(
      await prisma.rideStatusEvent.count({
        where: { rideId, toStatus: "IN_PROGRESS" },
      })
    ).toBe(1)
  })
  it("разрешает ручной старт просроченной опубликованной поездки", async () => {
    await prisma.ride.update({
      where: { id: rideId },
      data: { departureAt: new Date("2020-01-01") },
    })
    await startRide().expect(200)
  })
  it("после старта скрывает публичную карточку и запрещает новые заявки и отмены", async () => {
    const body = { seats: 1, requestKey: randomUUID() },
      created = await send(body).expect(201)
    await decide(created.body.id).expect(200)
    const paymentBefore = await prisma.payment.findUniqueOrThrow({
      where: { bookingId: created.body.id },
    })
    await startRide().expect(200)
    await request(app.getHttpServer()).get(`/api/rides/${rideId}`).expect(404)
    const search = await request(app.getHttpServer())
      .get(`/api/rides?originDistrictId=${district}`)
      .expect(200)
    expect(
      search.body.items.some((item: { id: string }) => item.id === rideId)
    ).toBe(false)
    await send({ seats: 1, requestKey: randomUUID() }, 2).expect(404)
    await cancel(created.body.id).expect(409)
    await cancelRide().expect(409)
    const replay = await send(body).expect(200)
    expect(replay.body.id).toBe(created.body.id)
    expect(replay.body.status).toBe("CONFIRMED")
    expect(
      await prisma.payment.findUniqueOrThrow({
        where: { bookingId: created.body.id },
      })
    ).toEqual(paymentBefore)
    expect(await prisma.booking.count({ where: { rideId } })).toBe(1)
  })
  it("при старте отклоняет ожидающую заявку, освобождает резерв и отменяет неоплаченный платёж", async () => {
    const id = await pending(3)
    const requestKey = (
      await prisma.booking.findUniqueOrThrow({ where: { id } })
    ).requestKey
    await startRide().expect(200)
    expect(await prisma.booking.findUnique({ where: { id } })).toMatchObject({
      status: "REJECTED",
      cancellationReason: START_REJECTION_REASON,
    })
    expect(
      await prisma.payment.findUnique({ where: { bookingId: id } })
    ).toMatchObject({ status: "CANCELLED", paidAt: null, refundedAt: null })
    expect(
      await prisma.bookingStatusEvent.findFirst({
        where: { bookingId: id, toStatus: "REJECTED" },
      })
    ).toMatchObject({
      actorId: driver,
      fromStatus: "PENDING",
      reason: START_REJECTION_REASON,
    })
    expect(
      (
        await prisma.booking.aggregate({
          where: { rideId, status: { in: ["PENDING", "CONFIRMED"] } },
          _sum: { seats: true },
        })
      )._sum.seats
    ).toBeNull()
    expect(
      (await list("status=REJECTED").expect(200)).body.items[0]
    ).toMatchObject({
      cancellationReason: START_REJECTION_REASON,
      payment: { status: "CANCELLED" },
    })
    expect(
      (await driverList().expect(200)).body.items[0].ride.availableSeats
    ).toBe(3)
    const replay = await send({ seats: 3, requestKey }).expect(200)
    expect(replay.body).toMatchObject({
      id,
      status: "REJECTED",
      payment: { status: "CANCELLED" },
    })
    expect(await prisma.booking.count({ where: { rideId } })).toBe(1)
  })
  it.each(["DRAFT", "CANCELLED", "COMPLETED"] as RideStatus[])(
    "не начинает поездку %s",
    async (status) => {
      await prisma.ride.update({ where: { id: rideId }, data: { status } })
      await startRide().expect(409)
      expect(await prisma.rideStatusEvent.count({ where: { rideId } })).toBe(0)
    }
  )
  it("не исправляет молча рассогласованные timestamps", async () => {
    await prisma.ride.update({
      where: { id: rideId },
      data: { startedAt: new Date() },
    })
    await startRide().expect(409)
    await prisma.ride.update({
      where: { id: rideId },
      data: { startedAt: null, completedAt: new Date() },
    })
    await startRide().expect(409)
    await prisma.ride.update({
      where: { id: rideId },
      data: { status: "IN_PROGRESS", completedAt: null },
    })
    await startRide().expect(409)
  })
  it("требует владельца, роль, сессию и разрешённый Origin для старта", async () => {
    await request(app.getHttpServer())
      .post(`/api/rides/${rideId}/start`)
      .set("Origin", origin)
      .send({})
      .expect(401)
    await startRide(rideId, 1).expect(403)
    await startRide(rideId, 3).expect(403)
    await prisma.userRole.create({
      data: { userId: accounts[2]!.id, role: "DRIVER" },
    })
    try {
      const other = await startRide(rideId, 2).expect(404),
        missing = await startRide(randomUUID(), 2).expect(404)
      expect(other.body).toEqual(missing.body)
    } finally {
      await prisma.userRole.delete({
        where: { userId_role: { userId: accounts[2]!.id, role: "DRIVER" } },
      })
    }
    await request(app.getHttpServer())
      .post(`/api/rides/${rideId}/start`)
      .set("Cookie", accounts[0]!.cookie)
      .send({})
      .expect(403)
    await request(app.getHttpServer())
      .post(`/api/rides/${rideId}/start`)
      .set("Cookie", accounts[0]!.cookie)
      .set("Origin", "https://other.test")
      .send({})
      .expect(403)
    await startRide("bad").expect(400)
  })
  it("учитывает блокировку и отзыв роли водителя при старте", async () => {
    await prisma.user.update({
      where: { id: driver },
      data: { status: "BLOCKED" },
    })
    try {
      await startRide().expect(401)
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
      await startRide().expect(403)
    } finally {
      await prisma.userRole.create({ data: { userId: driver, role: "DRIVER" } })
    }
  })
  it.each([
    { status: "IN_PROGRESS" },
    { startedAt: "2020-01-01" },
    { driverId: randomUUID() },
    { unexpected: true },
  ])("не принимает поля старта от клиента %j", async (body) => {
    await startRide(rideId, 0, body).expect(400)
  })
  it("старт допускает отсутствие тела", async () => {
    await request(app.getHttpServer())
      .post(`/api/rides/${rideId}/start`)
      .set("Cookie", accounts[0]!.cookie)
      .set("Origin", origin)
      .expect(200)
  })
  it("гонка старта и отмены поездки сохраняет один допустимый переход", async () => {
    const results = await Promise.all([startRide(), cancelRide()])
    expect(
      results.map((result) => result.status).sort((a, b) => a - b)
    ).toEqual([200, 409])
    expect(await prisma.rideStatusEvent.count({ where: { rideId } })).toBe(1)
    expect(["IN_PROGRESS", "CANCELLED"]).toContain(
      (await prisma.ride.findUniqueOrThrow({ where: { id: rideId } })).status
    )
  })
  it("гонка старта и новой заявки не оставляет PENDING у начатой поездки", async () => {
    const results = await Promise.all([startRide(), send()])
    expect([
      [200, 404],
      [200, 201],
    ]).toContainEqual(results.map((result) => result.status))
    const ride = await prisma.ride.findUniqueOrThrow({ where: { id: rideId } })
    expect(
      await prisma.booking.count({ where: { rideId, status: "PENDING" } })
    ).toBe(0)
    expect(ride.status).toBe("IN_PROGRESS")
  })
  it("ошибка после SQL-записи старта откатывает статус, время и событие", async () => {
    const original = prisma.$transaction.bind(prisma)
    const spy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>
    ) =>
      original(async (tx) =>
        callback(
          new Proxy(tx, {
            get(target, property, receiver) {
              if (property === "ride")
                return {
                  ...target.ride,
                  update: async (args: Prisma.RideUpdateArgs) => {
                    await target.ride.update(args)
                    throw new Error("private failure after write")
                  },
                }
              return Reflect.get(target, property, receiver)
            },
          })
        )
      )) as typeof prisma.$transaction)
    try {
      const result = await startRide().expect(503)
      expect(result.body.message).toBe("Начало поездки временно недоступно")
    } finally {
      spy.mockRestore()
    }
    expect(
      await prisma.ride.findUnique({ where: { id: rideId } })
    ).toMatchObject({ status: "PUBLISHED", startedAt: null })
    expect(await prisma.rideStatusEvent.count({ where: { rideId } })).toBe(0)
  })
  it("обрабатывает ожидающую заявку и сохраняет подтверждённую оплату", async () => {
    const confirmed = await pending(1)
    await decide(confirmed).expect(200)
    const paymentBefore = await prisma.payment.findUniqueOrThrow({
      where: { bookingId: confirmed },
    })
    const second = (
      await send({ seats: 2, requestKey: randomUUID() }, 2).expect(201)
    ).body.id
    await startRide().expect(200)
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: confirmed } }))
        .status
    ).toBe("CONFIRMED")
    expect(
      await prisma.payment.findUniqueOrThrow({
        where: { bookingId: confirmed },
      })
    ).toEqual(paymentBefore)
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: second } })).status
    ).toBe("REJECTED")
    expect(
      (await driverList().expect(200)).body.items.every(
        (item: { ride: { availableSeats: number } }) =>
          item.ride.availableSeats === 2
      )
    ).toBe(true)
  })
  async function pendingPair() {
    const first = await pending(2)
    const second = (
      await send({ seats: 1, requestKey: randomUUID() }, 2).expect(201)
    ).body.id as string
    return [first, second]
  }
  it("обрабатывает все PENDING в том числе нулевые платежи и просроченную поездку", async () => {
    await prisma.ride.update({
      where: { id: rideId },
      data: { priceKopecks: 0 },
    })
    const ids = await pendingPair()
    await prisma.ride.update({
      where: { id: rideId },
      data: { departureAt: new Date("2020-01-01") },
    })
    await startRide().expect(200)
    for (const id of ids) {
      expect(await prisma.booking.findUnique({ where: { id } })).toMatchObject({
        status: "REJECTED",
        cancellationReason: START_REJECTION_REASON,
      })
      expect(
        await prisma.payment.findUnique({ where: { bookingId: id } })
      ).toMatchObject({
        amountKopecks: 0n,
        status: "CANCELLED",
        paidAt: null,
        refundedAt: null,
      })
    }
  })
  it("параллельные и последовательные повторы не дублируют события и отмены платежей", async () => {
    const ids = await pendingPair()
    const results = await Promise.all([startRide(), startRide()])
    expect(results.map((result) => result.status)).toEqual([200, 200])
    expect(results[0]!.body).toEqual(results[1]!.body)
    const countNotifications = await prisma.notification.count({
      where: { userId: { in: accounts.map((account) => account.id) } },
    })
    const countLogs = await prisma.activityLog.count({
      where: { actorId: driver },
    })
    await startRide().expect(200)
    for (const id of ids)
      expect(
        await prisma.bookingStatusEvent.count({
          where: { bookingId: id, toStatus: "REJECTED" },
        })
      ).toBe(1)
    expect(
      await prisma.rideStatusEvent.count({
        where: { rideId, toStatus: "IN_PROGRESS" },
      })
    ).toBe(1)
    expect(await prisma.activityLog.count({ where: { actorId: driver } })).toBe(
      countLogs
    )
    expect(
      await prisma.notification.count({
        where: { userId: { in: accounts.map((account) => account.id) } },
      })
    ).toBe(countNotifications)
  })
  it("сохраняет историю ранее отклонённых и отменённых заявок", async () => {
    const rejected = await pending()
    await decide(rejected, "reject", { reason: "Другая причина" }).expect(200)
    const cancelled = (
      await send({ seats: 1, requestKey: randomUUID() }, 2).expect(201)
    ).body.id
    await cancel(cancelled, { reason: "Изменились планы" }, 2).expect(200)
    const beforeBookings = await prisma.booking.findMany({
      where: { rideId },
      orderBy: { id: "asc" },
    })
    const beforePayments = await prisma.payment.findMany({
      where: { booking: { rideId } },
      orderBy: { id: "asc" },
    })
    await startRide().expect(200)
    expect(
      await prisma.booking.findMany({
        where: { rideId },
        orderBy: { id: "asc" },
      })
    ).toEqual(beforeBookings)
    expect(
      await prisma.payment.findMany({
        where: { booking: { rideId } },
        orderBy: { id: "asc" },
      })
    ).toEqual(beforePayments)
  })
  it("ошибка второго уведомления отменяет ранее обработанную заявку и весь старт", async () => {
    const ids = await pendingPair(),
      spy = failNotificationWrite(2)
    const logsBefore = await prisma.activityLog.count({
      where: { actorId: driver },
    })
    try {
      await startRide().expect(503)
    } finally {
      spy.mockRestore()
    }
    expect(
      await prisma.ride.findUnique({ where: { id: rideId } })
    ).toMatchObject({ status: "PUBLISHED", startedAt: null })
    for (const id of ids) {
      expect(
        (await prisma.booking.findUniqueOrThrow({ where: { id } })).status
      ).toBe("PENDING")
      expect(
        (await prisma.payment.findUniqueOrThrow({ where: { bookingId: id } }))
          .status
      ).toBe("PENDING")
      expect(
        await prisma.bookingStatusEvent.count({ where: { bookingId: id } })
      ).toBe(1)
    }
    expect(await prisma.activityLog.count({ where: { actorId: driver } })).toBe(
      logsBefore
    )
    expect(
      await prisma.notification.count({
        where: {
          kind: "PAYMENT_UPDATED",
          userId: { in: accounts.map((account) => account.id) },
        },
      })
    ).toBe(0)
    expect(await prisma.rideStatusEvent.count({ where: { rideId } })).toBe(0)
    await startRide().expect(200)
  })
  it("сбой после записи статуса поездки откатывает уже отклонённые заявки и платежи", async () => {
    const ids = await pendingPair(),
      original = prisma.$transaction.bind(prisma)
    const spy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>
    ) =>
      original(async (tx) =>
        callback(
          new Proxy(tx, {
            get(target, property, receiver) {
              if (property === "ride")
                return {
                  ...target.ride,
                  update: async (args: Prisma.RideUpdateArgs) => {
                    await target.ride.update(args)
                    throw new Error("failure after ride write")
                  },
                }
              return Reflect.get(target, property, receiver)
            },
          })
        )
      )) as typeof prisma.$transaction)
    try {
      await startRide().expect(503)
    } finally {
      spy.mockRestore()
    }
    expect(
      await prisma.ride.findUnique({ where: { id: rideId } })
    ).toMatchObject({ status: "PUBLISHED", startedAt: null })
    for (const id of ids) {
      expect(
        (await prisma.booking.findUniqueOrThrow({ where: { id } })).status
      ).toBe("PENDING")
      expect(
        (await prisma.payment.findUniqueOrThrow({ where: { bookingId: id } }))
          .status
      ).toBe("PENDING")
      expect(
        await prisma.bookingStatusEvent.count({ where: { bookingId: id } })
      ).toBe(1)
    }
  })
  it("не скрывает некорректный оплаченный платёж у PENDING и откатывает начало", async () => {
    const ids = await pendingPair()
    const ordered = await prisma.booking.findMany({
      where: { id: { in: ids } },
      orderBy: { id: "asc" },
    })
    await prisma.payment.update({
      where: { bookingId: ordered[1]!.id },
      data: { status: "SUCCEEDED", paidAt: new Date() },
    })
    await startRide().expect(409)
    expect(
      await prisma.ride.findUnique({ where: { id: rideId } })
    ).toMatchObject({ status: "PUBLISHED", startedAt: null })
    expect(
      (
        await prisma.payment.findUniqueOrThrow({
          where: { bookingId: ordered[0]!.id },
        })
      ).status
    ).toBe("PENDING")
    expect(
      await prisma.booking.count({ where: { rideId, status: "REJECTED" } })
    ).toBe(0)
  })
  it("гонка старта и подтверждения сохраняет ровно одно решение по заявке", async () => {
    const id = await pending(),
      results = await Promise.all([startRide(), decide(id)])
    expect(results[0]!.status).toBe(200)
    expect([200, 409]).toContain(results[1]!.status)
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id } })
    expect(["CONFIRMED", "REJECTED"]).toContain(booking.status)
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { bookingId: id } }))
        .status
    ).toBe(booking.status === "CONFIRMED" ? "SUCCEEDED" : "CANCELLED")
    expect(
      await prisma.bookingStatusEvent.count({ where: { bookingId: id } })
    ).toBe(2)
    expect(
      (await prisma.ride.findUniqueOrThrow({ where: { id: rideId } })).status
    ).toBe("IN_PROGRESS")
  })
  it("гонка старта и отмены пассажира не оставляет активный резерв или платёж", async () => {
    const id = await pending(),
      results = await Promise.all([startRide(), cancel(id)])
    expect(results[0]!.status).toBe(200)
    expect([200, 409]).toContain(results[1]!.status)
    expect(["CANCELLED", "REJECTED"]).toContain(
      (await prisma.booking.findUniqueOrThrow({ where: { id } })).status
    )
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { bookingId: id } }))
        .status
    ).toBe("CANCELLED")
    expect(
      await prisma.bookingStatusEvent.count({ where: { bookingId: id } })
    ).toBe(2)
  })
  const completeRide = (id = rideId, account = 0, body: object = {}) =>
    request(app.getHttpServer())
      .post(`/api/rides/${id}/complete`)
      .set("Cookie", accounts[account]!.cookie)
      .set("Origin", origin)
      .send(body)
  it("завершает начатую поездку и сохраняет время и события при повторах", async () => {
    const started = await startRide().expect(200),
      before = Date.now()
    const first = await completeRide().expect(200)
    expect(first.headers["cache-control"]).toBe("no-store")
    expect(first.body).toEqual({
      id: rideId,
      status: "COMPLETED",
      startedAt: started.body.startedAt,
      completedAt: expect.any(String),
    })
    expect(new Date(first.body.completedAt).getTime()).toBeGreaterThanOrEqual(
      before
    )
    expect(new Date(first.body.completedAt).getTime()).toBeLessThanOrEqual(
      Date.now()
    )
    expect((await completeRide().expect(200)).body).toEqual(first.body)
    const events = await prisma.rideStatusEvent.findMany({
      where: { rideId, toStatus: "COMPLETED" },
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      actorId: driver,
      fromStatus: "IN_PROGRESS",
      reason: null,
    })
    const own = await request(app.getHttpServer())
      .get(`/api/me/rides/${rideId}`)
      .set("Cookie", accounts[0]!.cookie)
      .expect(200)
    expect(own.body).toMatchObject({
      status: "COMPLETED",
      completedAt: first.body.completedAt,
      startedAt: started.body.startedAt,
    })
  })
  it("атомарно завершает все подтверждённые бронирования и сохраняет оплаты без новых операций", async () => {
    const first = await pending(2)
    await decide(first).expect(200)
    const second = (
      await send({ seats: 1, requestKey: randomUUID() }, 2).expect(201)
    ).body.id as string
    await decide(second).expect(200)
    await startRide().expect(200)
    const paymentsBefore = await prisma.payment.findMany({
      where: { booking: { rideId } },
      orderBy: { id: "asc" },
    })
    const notificationsBefore = await prisma.notification.count({
      where: { userId: { in: accounts.map((account) => account.id) } },
    })
    const logsBefore = await prisma.activityLog.count({
      where: { actorId: driver },
    })
    await completeRide().expect(200)
    for (const id of [first, second]) {
      expect(
        (await prisma.booking.findUniqueOrThrow({ where: { id } })).status
      ).toBe("COMPLETED")
      const events = await prisma.bookingStatusEvent.findMany({
        where: { bookingId: id, toStatus: "COMPLETED" },
      })
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        actorId: driver,
        fromStatus: "CONFIRMED",
        reason: null,
      })
    }
    expect(
      await prisma.payment.findMany({
        where: { booking: { rideId } },
        orderBy: { id: "asc" },
      })
    ).toEqual(paymentsBefore)
    expect(
      (await list("status=COMPLETED&period=history").expect(200)).body.items[0]
        .status
    ).toBe("COMPLETED")
    expect((await driverList("status=COMPLETED").expect(200)).body.total).toBe(
      2
    )
    expect(
      await prisma.notification.count({
        where: { userId: { in: accounts.map((account) => account.id) } },
      })
    ).toBe(notificationsBefore + 3)
    expect(await prisma.activityLog.count({ where: { actorId: driver } })).toBe(
      logsBefore + 3
    )
  })
  it("не меняет ранее отменённые и отклонённые заявки или платежи", async () => {
    const rejected = await pending(1)
    await decide(rejected, "reject", { reason: "Исторический отказ" }).expect(
      200
    )
    const cancelled = (
      await send({ seats: 1, requestKey: randomUUID() }).expect(201)
    ).body.id
    await cancel(cancelled, { reason: "Историческая отмена" }).expect(200)
    const confirmed = (
      await send({ seats: 1, requestKey: randomUUID() }).expect(201)
    ).body.id
    await decide(confirmed).expect(200)
    await send({ seats: 1, requestKey: randomUUID() }, 2).expect(201)
    await startRide().expect(200)
    const before = await prisma.booking.findMany({
      where: { rideId, status: { not: "CONFIRMED" } },
      orderBy: { id: "asc" },
    })
    const payments = await prisma.payment.findMany({
      where: { booking: { rideId } },
      orderBy: { id: "asc" },
    })
    await completeRide().expect(200)
    for (const record of before)
      expect(
        await prisma.booking.findUniqueOrThrow({ where: { id: record.id } })
      ).toEqual(record)
    expect(
      await prisma.payment.findMany({
        where: { booking: { rideId } },
        orderBy: { id: "asc" },
      })
    ).toEqual(payments)
  })
  it("завершает бесплатную поездку, сохраняя успешный нулевой демо-платёж", async () => {
    await prisma.ride.update({
      where: { id: rideId },
      data: { priceKopecks: 0 },
    })
    const id = await pending()
    await decide(id).expect(200)
    await startRide().expect(200)
    const before = await prisma.payment.findUniqueOrThrow({
      where: { bookingId: id },
    })
    await completeRide().expect(200)
    expect(
      await prisma.payment.findUniqueOrThrow({ where: { bookingId: id } })
    ).toEqual(before)
    expect(before).toMatchObject({
      amountKopecks: 0n,
      status: "SUCCEEDED",
      refundedAt: null,
    })
  })
  it("параллельные завершения не дублируют время и события бронирования", async () => {
    const id = await pending()
    await decide(id).expect(200)
    await startRide().expect(200)
    const results = await Promise.all([completeRide(), completeRide()])
    expect(results.map((result) => result.status)).toEqual([200, 200])
    expect(results[0]!.body).toEqual(results[1]!.body)
    expect(
      await prisma.rideStatusEvent.count({
        where: { rideId, toStatus: "COMPLETED" },
      })
    ).toBe(1)
    expect(
      await prisma.bookingStatusEvent.count({
        where: { bookingId: id, toStatus: "COMPLETED" },
      })
    ).toBe(1)
  })
  it.each(["DRAFT", "PUBLISHED", "CANCELLED"] as RideStatus[])(
    "не завершает поездку %s",
    async (status) => {
      await prisma.ride.update({ where: { id: rideId }, data: { status } })
      await completeRide().expect(409)
      expect(await prisma.rideStatusEvent.count({ where: { rideId } })).toBe(0)
    }
  )
  it("не подменяет некорректные времена начала или завершения", async () => {
    await prisma.ride.update({
      where: { id: rideId },
      data: { status: "IN_PROGRESS" },
    })
    await completeRide().expect(409)
    await prisma.ride.update({
      where: { id: rideId },
      data: { startedAt: new Date("2099-01-01") },
    })
    await completeRide().expect(409)
    await prisma.ride.update({
      where: { id: rideId },
      data: { startedAt: new Date("2020-01-01"), completedAt: new Date() },
    })
    await completeRide().expect(409)
    await prisma.ride.update({
      where: { id: rideId },
      data: { status: "COMPLETED", completedAt: new Date("2019-01-01") },
    })
    await completeRide().expect(409)
    await prisma.ride.update({
      where: { id: rideId },
      data: { completedAt: null },
    })
    await completeRide().expect(409)
  })
  it("не завершает начатую поездку с неожиданной ожидающей заявкой", async () => {
    await startRide().expect(200)
    await prisma.booking.create({
      data: {
        rideId,
        passengerId: accounts[1]!.id,
        requestKey: randomUUID(),
        seats: 1,
        unitPriceKopecks: 15015,
        status: "PENDING",
      },
    })
    await completeRide().expect(409)
    expect(
      (await prisma.ride.findUniqueOrThrow({ where: { id: rideId } })).status
    ).toBe("IN_PROGRESS")
  })
  it("не завершает неоплаченную подтверждённую заявку и откатывает ранее обработанную", async () => {
    const first = await pending(2)
    await decide(first).expect(200)
    const second = (
      await send({ seats: 1, requestKey: randomUUID() }, 2).expect(201)
    ).body.id
    await decide(second).expect(200)
    await startRide().expect(200)
    const ordered = await prisma.booking.findMany({
      where: { rideId },
      orderBy: { id: "asc" },
    })
    await prisma.payment.update({
      where: { bookingId: ordered[1]!.id },
      data: { status: "PENDING" },
    })
    await completeRide().expect(409)
    expect(
      await prisma.booking.count({ where: { rideId, status: "COMPLETED" } })
    ).toBe(0)
    expect(
      (await prisma.ride.findUniqueOrThrow({ where: { id: rideId } }))
        .completedAt
    ).toBeNull()
  })
  it("защищает завершение владельцем, ролью, сессией и Origin", async () => {
    await startRide().expect(200)
    await request(app.getHttpServer())
      .post(`/api/rides/${rideId}/complete`)
      .set("Origin", origin)
      .send({})
      .expect(401)
    await completeRide(rideId, 1).expect(403)
    await completeRide(rideId, 3).expect(403)
    await prisma.userRole.create({
      data: { userId: accounts[2]!.id, role: "DRIVER" },
    })
    try {
      const other = await completeRide(rideId, 2).expect(404),
        missing = await completeRide(randomUUID(), 2).expect(404)
      expect(other.body).toEqual(missing.body)
    } finally {
      await prisma.userRole.delete({
        where: { userId_role: { userId: accounts[2]!.id, role: "DRIVER" } },
      })
    }
    await request(app.getHttpServer())
      .post(`/api/rides/${rideId}/complete`)
      .set("Cookie", accounts[0]!.cookie)
      .send({})
      .expect(403)
    await request(app.getHttpServer())
      .post(`/api/rides/${rideId}/complete`)
      .set("Cookie", accounts[0]!.cookie)
      .set("Origin", "https://other.test")
      .send({})
      .expect(403)
    await completeRide("bad").expect(400)
  })
  it("учитывает блокировку и отзыв роли при завершении", async () => {
    await startRide().expect(200)
    await prisma.user.update({
      where: { id: driver },
      data: { status: "BLOCKED" },
    })
    try {
      await completeRide().expect(401)
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
      await completeRide().expect(403)
    } finally {
      await prisma.userRole.create({ data: { userId: driver, role: "DRIVER" } })
    }
  })
  it.each([
    { status: "COMPLETED" },
    { startedAt: "2020-01-01" },
    { completedAt: "2020-01-01" },
    { driverId: randomUUID() },
  ])("не принимает поля завершения от клиента %j", async (body) => {
    await completeRide(rideId, 0, body).expect(400)
  })
  it("завершение допускает отсутствие тела", async () => {
    await startRide().expect(200)
    await request(app.getHttpServer())
      .post(`/api/rides/${rideId}/complete`)
      .set("Cookie", accounts[0]!.cookie)
      .set("Origin", origin)
      .expect(200)
  })
  it("после завершения нельзя заново начать поездку, забронировать место или оформить обычный возврат", async () => {
    const id = await pending()
    await decide(id).expect(200)
    await startRide().expect(200)
    await completeRide().expect(200)
    await startRide().expect(409)
    await send({ seats: 1, requestKey: randomUUID() }, 2).expect(404)
    await cancel(id).expect(409)
    await cancelRide().expect(409)
    await request(app.getHttpServer()).get(`/api/rides/${rideId}`).expect(404)
  })
  it("сбой обработки второй заявки откатывает первое завершённое бронирование", async () => {
    const first = await pending(2)
    await decide(first).expect(200)
    const second = (
      await send({ seats: 1, requestKey: randomUUID() }, 2).expect(201)
    ).body.id
    await decide(second).expect(200)
    const started = await startRide().expect(200),
      original = prisma.$transaction.bind(prisma)
    let writes = 0
    const spy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>
    ) =>
      original(async (tx) =>
        callback(
          new Proxy(tx, {
            get(target, property, receiver) {
              if (property === "booking")
                return {
                  ...target.booking,
                  update: async (args: Prisma.BookingUpdateArgs) => {
                    if (++writes === 2)
                      throw new Error("private booking failure")
                    return target.booking.update(args)
                  },
                }
              return Reflect.get(target, property, receiver)
            },
          })
        )
      )) as typeof prisma.$transaction)
    try {
      const result = await completeRide().expect(503)
      expect(result.body.message).toBe("Завершение поездки временно недоступно")
    } finally {
      spy.mockRestore()
    }
    expect(writes).toBe(2)
    expect(
      await prisma.booking.count({ where: { rideId, status: "CONFIRMED" } })
    ).toBe(2)
    expect(
      await prisma.bookingStatusEvent.count({
        where: { bookingId: { in: [first, second] }, toStatus: "COMPLETED" },
      })
    ).toBe(0)
    expect(
      await prisma.ride.findUnique({ where: { id: rideId } })
    ).toMatchObject({
      status: "IN_PROGRESS",
      startedAt: new Date(started.body.startedAt),
      completedAt: null,
    })
    await completeRide().expect(200)
  })
  it("сбой после записи завершения поездки откатывает все статусы и события", async () => {
    const id = await pending()
    await decide(id).expect(200)
    await startRide().expect(200)
    const payment = await prisma.payment.findUniqueOrThrow({
        where: { bookingId: id },
      }),
      original = prisma.$transaction.bind(prisma)
    const spy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>
    ) =>
      original(async (tx) =>
        callback(
          new Proxy(tx, {
            get(target, property, receiver) {
              if (property === "ride")
                return {
                  ...target.ride,
                  update: async (args: Prisma.RideUpdateArgs) => {
                    await target.ride.update(args)
                    throw new Error("private failure after ride write")
                  },
                }
              return Reflect.get(target, property, receiver)
            },
          })
        )
      )) as typeof prisma.$transaction)
    try {
      await completeRide().expect(503)
    } finally {
      spy.mockRestore()
    }
    expect(
      await prisma.ride.findUnique({ where: { id: rideId } })
    ).toMatchObject({ status: "IN_PROGRESS", completedAt: null })
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id } })).status
    ).toBe("CONFIRMED")
    expect(
      await prisma.bookingStatusEvent.count({
        where: { bookingId: id, toStatus: "COMPLETED" },
      })
    ).toBe(0)
    expect(
      await prisma.rideStatusEvent.count({
        where: { rideId, toStatus: "COMPLETED" },
      })
    ).toBe(0)
    expect(
      await prisma.payment.findUniqueOrThrow({ where: { bookingId: id } })
    ).toEqual(payment)
  })
  it("конкурентные завершение и отмена не возвращают оплату начатой поездки", async () => {
    const id = await pending()
    await decide(id).expect(200)
    await startRide().expect(200)
    const results = await Promise.all([
      completeRide(),
      cancel(id),
      cancelRide(),
    ])
    expect(results.map((result) => result.status)).toEqual([200, 409, 409])
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { bookingId: id } }))
        .status
    ).toBe("SUCCEEDED")
  })
  it("адресует уведомления участникам и не дублирует их при повторах", async () => {
    const confirmed = await pending(1)
    await decide(confirmed).expect(200)
    const rejected = (
      await send({ seats: 1, requestKey: randomUUID() }, 2).expect(201)
    ).body.id as string
    await startRide().expect(200)
    const started = await prisma.notification.findMany({
      where: { resourceId: rideId, kind: "RIDE_STARTED" },
    })
    expect(started.map((row) => row.userId).sort()).toEqual(
      [driver, accounts[1]!.id].sort()
    )
    expect(started.find((row) => row.userId === driver)?.link).toBe("#/rides")
    expect(started.find((row) => row.userId !== driver)?.link).toBe(
      "#/bookings"
    )
    const rejection = await prisma.notification.findMany({
      where: { resourceId: rejected, kind: "BOOKING_REJECTED" },
    })
    expect(rejection).toHaveLength(1)
    expect(rejection[0]).toMatchObject({
      userId: accounts[2]!.id,
      body: START_REJECTION_REASON,
      link: "#/bookings",
    })
    expect(
      await prisma.activityLog.findFirst({
        where: { resourceId: rejected, action: "booking.rejected" },
      })
    ).toMatchObject({
      actorId: driver,
      details: { automatic: true, reason: START_REJECTION_REASON, rideId },
    })
    await startRide().expect(200)
    await Promise.all([completeRide().expect(200), completeRide().expect(200)])
    expect(
      await prisma.notification.count({
        where: { resourceId: rideId, kind: "RIDE_STARTED" },
      })
    ).toBe(2)
    expect(
      await prisma.notification.findMany({
        where: { resourceId: rideId, kind: "RIDE_COMPLETED" },
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: driver, link: "#/rides" }),
        expect.objectContaining({
          userId: accounts[1]!.id,
          link: "#/bookings",
        }),
      ])
    )
    expect(
      await prisma.notification.count({
        where: { resourceId: rideId, kind: "RIDE_COMPLETED" },
      })
    ).toBe(2)
    for (const action of ["ride.started", "ride.completed"])
      expect(
        await prisma.activityLog.count({
          where: { resourceId: rideId, action },
        })
      ).toBe(1)
    expect(
      await prisma.activityLog.count({
        where: { resourceId: confirmed, action: "booking.completed" },
      })
    ).toBe(1)
    expect(
      (await notifications("kind=RIDE_COMPLETED", 2).expect(200)).body.total
    ).toBe(0)
    expect(
      (await notifications("kind=RIDE_COMPLETED", 1).expect(200)).body.total
    ).toBe(1)
  })
  it.each([false, true])(
    "откатывает переход и журнал при сбое уведомления (завершение=%s)",
    async (completed) => {
      const id = await pending()
      if (completed) {
        await decide(id).expect(200)
        await startRide().expect(200)
      }
      const before = await prisma.activityLog.count({
        where: { actorId: driver },
      })
      const notificationCount = await prisma.notification.count({
        where: { userId: { in: accounts.map((account) => account.id) } },
      })
      // При старте первая запись — уведомление платежа, вторая — автоотклонение.
      const spy = failNotificationWrite(completed ? 2 : 3)
      try {
        await (completed ? completeRide() : startRide()).expect(503)
      } finally {
        spy.mockRestore()
      }
      expect(
        (await prisma.ride.findUniqueOrThrow({ where: { id: rideId } })).status
      ).toBe(completed ? "IN_PROGRESS" : "PUBLISHED")
      expect(
        (await prisma.booking.findUniqueOrThrow({ where: { id } })).status
      ).toBe(completed ? "CONFIRMED" : "PENDING")
      expect(
        await prisma.activityLog.count({ where: { actorId: driver } })
      ).toBe(before)
      expect(
        await prisma.notification.count({
          where: { userId: { in: accounts.map((account) => account.id) } },
        })
      ).toBe(notificationCount)
      await (completed ? completeRide() : startRide()).expect(200)
    }
  )
  it.each([false, true])(
    "сбой журнала откатывает жизненный цикл (завершение=%s)",
    async (completed) => {
      const id = await pending()
      if (completed) {
        await decide(id).expect(200)
        await startRide().expect(200)
      }
      const original = prisma.$transaction.bind(prisma)
      const spy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(((
        callback: (tx: Prisma.TransactionClient) => Promise<unknown>
      ) =>
        original(async (tx) =>
          callback(
            new Proxy(tx, {
              get(target, property, receiver) {
                if (property === "activityLog")
                  return {
                    ...target.activityLog,
                    create: async (args: Prisma.ActivityLogCreateArgs) => {
                      if (
                        args.data.action ===
                        (completed ? "ride.completed" : "ride.started")
                      )
                        throw new Error("audit unavailable")
                      return target.activityLog.create(args)
                    },
                  }
                return Reflect.get(target, property, receiver)
              },
            })
          )
        )) as typeof prisma.$transaction)
      try {
        await (completed ? completeRide() : startRide()).expect(503)
      } finally {
        spy.mockRestore()
      }
      expect(
        (await prisma.ride.findUniqueOrThrow({ where: { id: rideId } })).status
      ).toBe(completed ? "IN_PROGRESS" : "PUBLISHED")
      expect(
        (await prisma.booking.findUniqueOrThrow({ where: { id } })).status
      ).toBe(completed ? "CONFIRMED" : "PENDING")
      expect(
        await prisma.activityLog.count({
          where: {
            resourceId: rideId,
            action: completed ? "ride.completed" : "ride.started",
          },
        })
      ).toBe(0)
      expect(
        await prisma.notification.count({
          where: {
            resourceId: rideId,
            kind: completed ? "RIDE_COMPLETED" : "RIDE_STARTED",
          },
        })
      ).toBe(0)
    }
  )
  it("полный сценарий: черновик → публикация → поиск → бронь → подтверждение → старт → завершение → история → встречные отзывы", async () => {
    const upcomingRideId = rideId
    const created = await request(app.getHttpServer())
      .post("/api/rides")
      .set("Cookie", accounts[0]!.cookie)
      .set("Origin", origin)
      .send({
        vehicleId: vehicle,
        originId: start,
        destinationId: finish,
        departureAt: "2099-11-09T03:00:00Z",
        seatsTotal: 3,
        priceKopecks: 15015,
        conditions: "Встреча у метро Уралмаш, небольшой рюкзак разрешён.",
      })
      .expect(201)
    rideId = created.body.id as string
    rides.push(rideId)
    expect(created.body.status).toBe("DRAFT")
    await request(app.getHttpServer()).get(`/api/rides/${rideId}`).expect(404)
    await request(app.getHttpServer())
      .post(`/api/rides/${rideId}/publish`)
      .set("Cookie", accounts[0]!.cookie)
      .set("Origin", origin)
      .send({})
      .expect(200)
    const search = await request(app.getHttpServer())
      .get(
        `/api/rides?originDistrictId=${district}&date=2099-11-09&timeFrom=07:00&timeTo=09:00&minSeats=2&maxPriceKopecks=16000&q=рюкзак`
      )
      .expect(200)
    expect(search.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: rideId, availableSeats: 3 }),
      ])
    )
    const detail = await request(app.getHttpServer())
      .get(`/api/rides/${rideId}`)
      .expect(200)
    expect(detail.body).toMatchObject({
      id: rideId,
      priceKopecks: 15015,
      availableSeats: 3,
    })
    const body = { seats: 2, requestKey: randomUUID() }
    const booking = await send(body).expect(201)
    expect(booking.body).toMatchObject({
      status: "PENDING",
      payment: { status: "PENDING", amountKopecks: 30030, isDemo: true },
    })
    const waiting = await send(
      { seats: 1, requestKey: randomUUID() },
      2
    ).expect(201)
    expect((await driverList(`rideId=${rideId}`).expect(200)).body.total).toBe(
      2
    )
    await decide(booking.body.id).expect(200)
    expect(
      (await list("period=upcoming&status=CONFIRMED").expect(200)).body.items
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: booking.body.id,
          payment: expect.objectContaining({
            status: "SUCCEEDED",
            amountKopecks: 30030,
          }),
        }),
      ])
    )
    await review(booking.body.id).expect(409)
    expect((await ratings().expect(200)).body.driver).toEqual({
      average: null,
      count: 0,
    })
    const started = await startRide().expect(200)
    expect(
      (await notifications("kind=RIDE_STARTED").expect(200)).body.total
    ).toBe(1)
    expect(
      (await notifications("kind=BOOKING_REJECTED", 2).expect(200)).body.items
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: waiting.body.id,
          body: START_REJECTION_REASON,
        }),
      ])
    )
    await request(app.getHttpServer()).get(`/api/rides/${rideId}`).expect(404)
    const completed = await completeRide().expect(200)
    expect(completed.body.startedAt).toBe(started.body.startedAt)
    const history = await list("period=history&status=COMPLETED").expect(200)
    expect(history.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: booking.body.id,
          status: "COMPLETED",
          payment: expect.objectContaining({
            status: "SUCCEEDED",
            amountKopecks: 30030,
          }),
        }),
      ])
    )
    expect((await list("period=upcoming").expect(200)).body.total).toBe(0)
    expect(
      (await driverList(`rideId=${rideId}&status=COMPLETED`).expect(200)).body
        .total
    ).toBe(1)
    const inbox = await notifications("kind=RIDE_COMPLETED").expect(200)
    expect(inbox.body.total).toBe(1)
    await request(app.getHttpServer())
      .patch(`/api/notifications/${inbox.body.items[0].id}/read`)
      .set("Cookie", accounts[1]!.cookie)
      .set("Origin", origin)
      .send({})
      .expect(200)
    expect(
      (await notifications("kind=RIDE_COMPLETED&read=true").expect(200)).body
        .total
    ).toBe(1)
    const replay = await send(body).expect(200)
    expect(replay.body).toMatchObject({
      id: booking.body.id,
      status: "COMPLETED",
    })
    expect((await completeRide().expect(200)).body).toEqual(completed.body)
    await startRide().expect(409)
    await cancel(booking.body.id).expect(409)
    expect(
      await prisma.payment.count({
        where: { booking: { rideId }, status: "REFUNDED" },
      })
    ).toBe(0)
    expect(
      await prisma.rideStatusEvent.findMany({
        where: { rideId },
        orderBy: { createdAt: "asc" },
        select: { toStatus: true },
      })
    ).toEqual([
      { toStatus: "PUBLISHED" },
      { toStatus: "IN_PROGRESS" },
      { toStatus: "COMPLETED" },
    ])
    expect(
      await prisma.notification.count({
        where: { resourceId: rideId, kind: "RIDE_COMPLETED" },
      })
    ).toBe(2)
    const passengerReview = await review(booking.body.id).expect(201)
    const driverReview = await review(booking.body.id, 0, {
      rating: 4,
      comment: "Пассажир пришёл вовремя.",
    }).expect(201)
    expect((await ratings().expect(200)).body).toEqual({
      driver: { average: 5, count: 1 },
      passenger: { average: null, count: 0 },
    })
    expect((await ratings(accounts[1]!.id).expect(200)).body).toEqual({
      driver: { average: null, count: 0 },
      passenger: { average: 4, count: 1 },
    })
    const card = await request(app.getHttpServer())
      .get(`/api/rides/${upcomingRideId}`)
      .expect(200)
    expect(card.body.driver).toMatchObject({
      id: driver,
      rating: 5,
      reviewCount: 1,
    })
    expect(
      (
        await ownReviews(`direction=sent&bookingId=${booking.body.id}`).expect(
          200
        )
      ).body.items
    ).toEqual([
      expect.objectContaining({ id: passengerReview.body.id, rating: 5 }),
    ])
    expect(
      (
        await ownReviews(
          `direction=received&bookingId=${booking.body.id}`
        ).expect(200)
      ).body.items
    ).toEqual([
      expect.objectContaining({ id: driverReview.body.id, rating: 4 }),
    ])
    expect(
      (await notifications("kind=REVIEW_RECEIVED", 0).expect(200)).body.items[0]
    ).toMatchObject({ resourceId: passengerReview.body.id, link: "#/reviews" })
    expect(
      (await notifications("kind=REVIEW_RECEIVED", 1).expect(200)).body.items[0]
    ).toMatchObject({ resourceId: driverReview.body.id, link: "#/reviews" })
    await review(booking.body.id).expect(409)
    await review(booking.body.id, 0).expect(409)
    await review(booking.body.id, 2).expect(404)
    await review(waiting.body.id, 2).expect(409)
    expect(
      await prisma.review.count({ where: { bookingId: booking.body.id } })
    ).toBe(2)
    const ids = [passengerReview.body.id, driverReview.body.id]
    expect(
      await prisma.notification.count({
        where: { resourceId: { in: ids }, kind: "REVIEW_RECEIVED" },
      })
    ).toBe(2)
    expect(
      await prisma.activityLog.count({
        where: { resourceId: { in: ids }, action: "review.created" },
      })
    ).toBe(2)
  })
  const review = (
    id: string,
    account = 1,
    body: object = {
      rating: 5,
      comment: "  Водитель приехал вовремя, поездка комфортная.  ",
    }
  ) =>
    request(app.getHttpServer())
      .post(`/api/bookings/${id}/reviews`)
      .set("Cookie", accounts[account]!.cookie)
      .set("Origin", origin)
      .send(body)
  const completedBooking = async () => {
    const id = await pending(1)
    await decide(id).expect(200)
    await startRide().expect(200)
    await completeRide().expect(200)
    return id
  }
  it("пассажир и водитель оставляют встречные отзывы с серверными участниками", async () => {
    const id = await completedBooking()
    const passenger = await review(id).expect(201)
    expect(passenger.headers["cache-control"]).toBe("no-store")
    expect(passenger.body).toEqual({
      id: expect.any(String),
      bookingId: id,
      authorId: accounts[1]!.id,
      recipientId: driver,
      rating: 5,
      comment: "Водитель приехал вовремя, поездка комфортная.",
      createdAt: expect.any(String),
    })
    const driverReview = await review(id, 0, {
      rating: 4,
      comment: "Пассажир был на месте вовремя.",
    }).expect(201)
    expect(driverReview.body).toMatchObject({
      authorId: driver,
      recipientId: accounts[1]!.id,
      rating: 4,
    })
    expect(await prisma.review.count({ where: { bookingId: id } })).toBe(2)
    await review(id).expect(409)
    await review(id, 0, { rating: 1, comment: "Изменённый отзыв" }).expect(409)
  })
  it("параллельные отзывы одного автора создают ровно одну запись", async () => {
    const id = await completedBooking()
    const results = await Promise.all([review(id), review(id)])
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ])
    expect(await prisma.review.count({ where: { bookingId: id } })).toBe(1)
  })
  it("чужая и отсутствующая заявки одинаково недоступны, администратор не обходит права", async () => {
    const id = await completedBooking()
    const other = await review(id, 2).expect(404)
    const missing = await review(randomUUID(), 2).expect(404)
    expect(other.body.message).toBe(missing.body.message)
    await review(id, 3).expect(403)
  })
  it("без сессии, с чужим Origin и неверным UUID отзыв недоступен", async () => {
    const id = await completedBooking()
    await request(app.getHttpServer())
      .post(`/api/bookings/${id}/reviews`)
      .set("Origin", origin)
      .send({ rating: 5, comment: "Спасибо" })
      .expect(401)
    await request(app.getHttpServer())
      .post(`/api/bookings/${id}/reviews`)
      .set("Cookie", accounts[1]!.cookie)
      .set("Origin", "https://example.org")
      .send({ rating: 5, comment: "Спасибо" })
      .expect(403)
    await request(app.getHttpServer())
      .post(`/api/bookings/${id}/reviews`)
      .set("Cookie", accounts[1]!.cookie)
      .send({ rating: 5, comment: "Спасибо" })
      .expect(403)
    await review("bad").expect(400)
  })
  it.each([
    {},
    { rating: 0, comment: "Спасибо" },
    { rating: 6, comment: "Спасибо" },
    { rating: 1.5, comment: "Спасибо" },
    { rating: "5", comment: "Спасибо" },
    { rating: 5, comment: "   " },
    { rating: 5, comment: "а".repeat(1001) },
    { rating: 5, comment: null },
    { rating: 5, comment: 123 },
    { rating: 5, comment: "Спасибо", authorId: randomUUID() },
    { rating: 5, comment: "Спасибо", recipientId: randomUUID() },
    { rating: 5, comment: "Спасибо", hiddenAt: null },
  ])("отклоняет некорректное тело отзыва %j", async (body) => {
    const id = await completedBooking()
    await review(id, 1, body).expect(400)
    expect(await prisma.review.count({ where: { bookingId: id } })).toBe(0)
  })
  it.each(["PENDING", "CONFIRMED", "REJECTED", "CANCELLED"] as BookingStatus[])(
    "не принимает отзыв для заявки %s",
    async (status) => {
      const id = await completedBooking()
      await prisma.booking.update({ where: { id }, data: { status } })
      await review(id).expect(409)
    }
  )
  it.each(["DRAFT", "PUBLISHED", "IN_PROGRESS", "CANCELLED"] as RideStatus[])(
    "не принимает отзыв для поездки %s",
    async (status) => {
      const id = await completedBooking()
      await prisma.ride.update({ where: { id: rideId }, data: { status } })
      await review(id).expect(409)
    }
  )
  it("проверяет время завершения и роль участника", async () => {
    const id = await completedBooking()
    for (const data of [
      { startedAt: null },
      {
        startedAt: new Date("2099-01-01"),
        completedAt: new Date("2099-02-01"),
      },
      { startedAt: new Date(), completedAt: new Date("2000-01-01") },
    ]) {
      await prisma.ride.update({ where: { id: rideId }, data })
      await review(id).expect(409)
    }
    await prisma.userRole.delete({
      where: { userId_role: { userId: driver, role: "DRIVER" } },
    })
    try {
      await review(id, 0).expect(403)
    } finally {
      await prisma.userRole.create({ data: { userId: driver, role: "DRIVER" } })
    }
  })
  it("скрытый отзыв также запрещает повторную оценку", async () => {
    const id = await completedBooking()
    const created = await review(id).expect(201)
    await prisma.review.update({
      where: { id: created.body.id },
      data: { hiddenAt: new Date(), hiddenReason: "Проверка модерации" },
    })
    await review(id).expect(409)
  })
  it("сбой сохранения не создаёт отзыв и возвращает безопасную ошибку", async () => {
    const id = await completedBooking()
    const original = prisma.$transaction.bind(prisma)
    const spy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>
    ) =>
      original(async (tx) =>
        callback(
          new Proxy(tx, {
            get(target, property, receiver) {
              if (property === "review")
                return {
                  ...target.review,
                  create: () => {
                    throw new Error("secret database failure")
                  },
                }
              return Reflect.get(target, property, receiver)
            },
          })
        )
      )) as typeof prisma.$transaction)
    try {
      const result = await review(id).expect(503)
      expect(result.body.message).toBe("Создание отзыва временно недоступно")
    } finally {
      spy.mockRestore()
    }
    expect(await prisma.review.count({ where: { bookingId: id } })).toBe(0)
    await review(id).expect(201)
  })
  const ownReviews = (query = "", account = 1) =>
    request(app.getHttpServer())
      .get(`/api/me/reviews?${query}`)
      .set("Cookie", accounts[account]!.cookie)
  const publicReviews = (userId = driver, query = "") =>
    request(app.getHttpServer()).get(`/api/users/${userId}/reviews?${query}`)
  const ratings = (userId = driver) =>
    request(app.getHttpServer()).get(`/api/users/${userId}/ratings`)
  const reviewPair = async () => {
    const id = await completedBooking()
    const first = (await review(id).expect(201)).body.id as string
    const second = (
      await review(id, 0, {
        rating: 3,
        comment: "Пассажир приехал вовремя.",
      }).expect(201)
    ).body.id as string
    return { id, first, second }
  }
  it("выдаёт свои отправленные/полученные отзывы и безопасный публичный список", async () => {
    const { id, first, second } = await reviewPair()
    const received = await ownReviews().expect(200)
    expect(received.headers["cache-control"]).toBe("no-store")
    expect(received.body.items).toEqual([
      expect.objectContaining({
        id: second,
        bookingId: id,
        recipientRole: "PASSENGER",
      }),
    ])
    expect((await ownReviews("direction=sent").expect(200)).body.items).toEqual(
      [expect.objectContaining({ id: first, recipientRole: "DRIVER" })]
    )
    expect((await ownReviews("", 2).expect(200)).body.total).toBe(0)
    expect((await ownReviews("", 3).expect(200)).body.total).toBe(0)
    const visible = await publicReviews().expect(200)
    expect(visible.body.items).toEqual([
      {
        id: first,
        rating: 5,
        comment: "Водитель приехал вовремя, поездка комфортная.",
        createdAt: expect.any(String),
        recipientRole: "DRIVER",
        author: { id: accounts[1]!.id, fullName: "Анна Соколова" },
        recipient: { id: driver, fullName: "Анна Соколова" },
      },
    ])
    expect(JSON.stringify(visible.body)).not.toMatch(
      /bookingId|password|email|phone|hiddenReason|hiddenAt|requestKey/
    )
    await request(app.getHttpServer()).get("/api/me/reviews").expect(401)
  })
  it("объединяет поиск и пять фильтров, проверяет диапазоны и пустую страницу", async () => {
    const { first } = await reviewPair()
    const time = "2026-01-01T12:00:00Z"
    await prisma.review.update({
      where: { id: first },
      data: { createdAt: new Date(time) },
    })
    const query =
      "q=комфортная&recipientRole=DRIVER&ratingMin=4&ratingMax=5&dateFrom=2026-01-01T00:00:00Z&dateTo=2026-01-02T00:00:00Z"
    expect((await publicReviews(driver, query).expect(200)).body.total).toBe(1)
    expect(
      (await ownReviews(`direction=sent&${query}`).expect(200)).body.total
    ).toBe(1)
    for (const extra of [
      "q=несуществующий",
      "recipientRole=PASSENGER",
      "ratingMax=4",
      "dateFrom=2027-01-01T00:00:00Z",
    ])
      expect((await publicReviews(driver, extra).expect(200)).body.total).toBe(
        0
      )
    expect((await publicReviews(driver, "q=Анна").expect(200)).body.total).toBe(
      1
    )
    expect((await publicReviews(driver, "q=%").expect(200)).body.total).toBe(0)
    expect(
      (await publicReviews(driver, "page=99&pageSize=1").expect(200)).body
    ).toMatchObject({ items: [], total: 1, page: 99, pageSize: 1 })
    for (const query of [
      "ratingMin=5&ratingMax=1",
      "dateFrom=2027-01-01T00:00:00Z&dateTo=2026-01-01T00:00:00Z",
    ]) {
      await publicReviews(driver, query).expect(400)
      await ownReviews(query).expect(400)
    }
  })
  it("стабильно сортирует одинаковые даты и разбивает список на страницы", async () => {
    const { first, id } = await reviewPair()
    const booking = await prisma.booking.create({
      data: {
        rideId,
        passengerId: accounts[2]!.id,
        requestKey: randomUUID(),
        seats: 1,
        unitPriceKopecks: 15015,
        status: "COMPLETED",
      },
    })
    const second = (
      await review(booking.id, 2, {
        rating: 4,
        comment: "Удобная поездка",
      }).expect(201)
    ).body.id as string
    const time = new Date("2026-01-01T12:00:00Z")
    await prisma.review.updateMany({
      where: { id: { in: [first, second] } },
      data: { createdAt: time },
    })
    const ordered = [first, second].sort()
    for (const [index, expected] of ordered.entries())
      expect(
        (
          await publicReviews(
            driver,
            `sort=oldest&pageSize=1&page=${index + 1}`
          ).expect(200)
        ).body.items[0].id
      ).toBe(expected)
    expect(
      (await publicReviews(driver).expect(200)).body.items.map(
        (item: { id: string }) => item.id
      )
    ).toEqual([...ordered].reverse())
    expect((await ratings().expect(200)).body).toEqual({
      driver: { average: 4.5, count: 2 },
      passenger: { average: null, count: 0 },
    })
    expect((await ratings(accounts[1]!.id).expect(200)).body.passenger).toEqual(
      { average: 3, count: 1 }
    )
    expect(id).not.toBe(booking.id)
  })
  it("разделяет рейтинги одного пользователя в двух ролях", async () => {
    await reviewPair()
    await prisma.driverProfile.upsert({
      where: { userId: accounts[1]!.id },
      create: { userId: accounts[1]!.id },
      update: {},
    })
    const reverse = await prisma.ride.create({
      data: {
        driverId: accounts[1]!.id,
        vehicleId: vehicle,
        originId: start,
        destinationId: finish,
        departureAt: new Date("2020-01-01"),
        seatsTotal: 3,
        priceKopecks: 15015,
        status: "COMPLETED",
        startedAt: new Date("2020-01-01"),
        completedAt: new Date("2020-01-02"),
      },
    })
    rides.push(reverse.id)
    const booking = await prisma.booking.create({
      data: {
        rideId: reverse.id,
        passengerId: driver,
        requestKey: randomUUID(),
        seats: 1,
        unitPriceKopecks: 15015,
        status: "COMPLETED",
      },
    })
    await prisma.review.create({
      data: {
        bookingId: booking.id,
        authorId: accounts[1]!.id,
        recipientId: driver,
        rating: 2,
        comment: "Оценка пассажира",
      },
    })
    expect((await ratings().expect(200)).body).toEqual({
      driver: { average: 5, count: 1 },
      passenger: { average: 2, count: 1 },
    })
    expect(
      (await publicReviews(driver, "recipientRole=PASSENGER").expect(200)).body
        .items[0].rating
    ).toBe(2)
  })
  it("скрытие и некорректные исторические участники исключаются из списков и рейтинга", async () => {
    const { first, id } = await reviewPair()
    await prisma.review.update({
      where: { id: first },
      data: { hiddenAt: new Date(), hiddenReason: "Модерация" },
    })
    expect((await publicReviews().expect(200)).body.total).toBe(0)
    expect((await ownReviews("direction=sent").expect(200)).body.total).toBe(0)
    expect((await ratings().expect(200)).body.driver).toEqual({
      average: null,
      count: 0,
    })
    await prisma.review.update({
      where: { id: first },
      data: { hiddenAt: null, authorId: accounts[2]!.id },
    })
    expect((await ratings().expect(200)).body.driver.count).toBe(0)
    await prisma.review.update({
      where: { id: first },
      data: { authorId: accounts[1]!.id },
    })
    await prisma.booking.update({
      where: { id },
      data: { status: "CANCELLED" },
    })
    expect((await publicReviews().expect(200)).body.total).toBe(0)
  })
  it("отсутствующий и заблокированный получатель скрыты за 404", async () => {
    for (const id of [randomUUID(), driver]) {
      if (id === driver)
        await prisma.user.update({ where: { id }, data: { status: "BLOCKED" } })
      try {
        await publicReviews(id).expect(404)
        await ratings(id).expect(404)
      } finally {
        if (id === driver)
          await prisma.user.update({
            where: { id },
            data: { status: "ACTIVE" },
          })
      }
    }
    await publicReviews("bad").expect(400)
    await ratings("bad").expect(400)
    expect((await ratings(accounts[2]!.id).expect(200)).body).toEqual({
      driver: { average: null, count: 0 },
      passenger: { average: null, count: 0 },
    })
  })
  it.each([
    "recipientRole=ADMIN",
    "ratingMin=0",
    "ratingMax=6",
    "ratingMin=1.5",
    "dateFrom=oops",
    "dateTo=2026-01-01",
    "page=0",
    "pageSize=101",
    "sort=rating",
    "unknown=x",
  ])("отклоняет неверные параметры отзывов %s", async (query) => {
    await publicReviews(driver, query).expect(400)
    await ownReviews(query).expect(400)
  })
  it("публичный список не принимает direction и собственный — чужой userId", async () => {
    await publicReviews(driver, "direction=sent").expect(400)
    await ownReviews(`userId=${driver}`).expect(400)
    await ownReviews("direction=bad").expect(400)
  })
  it("при ошибке чтения возвращает безопасный 503", async () => {
    const spy = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(new Error("secret failure"))
    try {
      expect((await ratings().expect(503)).body.message).toBe(
        "Отзывы временно недоступны"
      )
    } finally {
      spy.mockRestore()
    }
    const listSpy = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(new Error("secret failure"))
    try {
      expect((await ownReviews().expect(503)).body.message).toBe(
        "Отзывы временно недоступны"
      )
    } finally {
      listSpy.mockRestore()
    }
  })
  it("фильтрует собственные отзывы по заявке без доступа к чужим данным", async () => {
    const { id, first, second } = await reviewPair()
    expect(
      (await ownReviews(`direction=sent&bookingId=${id}`).expect(200)).body
        .items
    ).toEqual([expect.objectContaining({ id: first, bookingId: id })])
    expect(
      (await ownReviews(`bookingId=${id}`).expect(200)).body.items
    ).toEqual([expect.objectContaining({ id: second })])
    expect(
      (await ownReviews(`direction=sent&bookingId=${id}`, 2).expect(200)).body
        .total
    ).toBe(0)
    expect(
      (await ownReviews(`direction=sent&bookingId=${randomUUID()}`).expect(200))
        .body.total
    ).toBe(0)
    await ownReviews("bookingId=bad").expect(400)
    await publicReviews(driver, `bookingId=${id}`).expect(400)
  })
  it("отзыв атомарно уведомляет получателя и сохраняет автора в журнале без дублей", async () => {
    const { first, second, id } = await reviewPair()
    const received = await notifications("kind=REVIEW_RECEIVED", 0).expect(200)
    expect(received.body.items).toEqual([
      expect.objectContaining({
        resourceId: first,
        resourceType: "review",
        link: "#/reviews",
        body: "Вас оценили как водителя. Оценка: 5 из 5.",
      }),
    ])
    expect(
      (await notifications("kind=REVIEW_RECEIVED", 1).expect(200)).body.items
    ).toEqual([
      expect.objectContaining({
        resourceId: second,
        body: "Вас оценили как пассажира. Оценка: 3 из 5.",
      }),
    ])
    expect(
      (await notifications("kind=REVIEW_RECEIVED", 2).expect(200)).body.total
    ).toBe(0)
    expect(
      await prisma.activityLog.findFirst({
        where: { resourceId: first, action: "review.created" },
      })
    ).toMatchObject({
      actorId: accounts[1]!.id,
      resourceType: "review",
      details: {
        bookingId: id,
        recipientId: driver,
        recipientRole: "DRIVER",
        rating: 5,
      },
    })
    await review(id).expect(409)
    expect(
      await prisma.notification.count({ where: { resourceId: first } })
    ).toBe(1)
    expect(
      await prisma.activityLog.count({
        where: { resourceId: first, action: "review.created" },
      })
    ).toBe(1)
  })
  it("ошибка уведомления откатывает отзыв, рейтинг и журнал", async () => {
    const id = await completedBooking()
    const spy = failNotificationWrite()
    try {
      await review(id).expect(503)
    } finally {
      spy.mockRestore()
    }
    expect(await prisma.review.count({ where: { bookingId: id } })).toBe(0)
    expect(
      await prisma.activityLog.count({
        where: { actorId: accounts[1]!.id, action: "review.created" },
      })
    ).toBe(0)
    expect((await ratings().expect(200)).body.driver.count).toBe(0)
    await review(id).expect(201)
  })
  it("ошибка журнала откатывает отзыв без уведомления", async () => {
    const id = await completedBooking()
    const original = prisma.$transaction.bind(prisma)
    const spy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>
    ) =>
      original(async (tx) =>
        callback(
          new Proxy(tx, {
            get(target, property, receiver) {
              if (property === "activityLog")
                return {
                  ...target.activityLog,
                  create: () => {
                    throw new Error("audit unavailable")
                  },
                }
              return Reflect.get(target, property, receiver)
            },
          })
        )
      )) as typeof prisma.$transaction)
    try {
      await review(id).expect(503)
    } finally {
      spy.mockRestore()
    }
    expect(await prisma.review.count({ where: { bookingId: id } })).toBe(0)
    expect(
      (await notifications("kind=REVIEW_RECEIVED", 0).expect(200)).body.total
    ).toBe(0)
  })
  const adminReviews = (query = "", account = 3) =>
    request(app.getHttpServer())
      .get(`/api/admin/reviews?${query}`)
      .set("Cookie", accounts[account]!.cookie)
  const moderate = (
    id: string,
    action = "hide",
    body: object = { reason: "  Нарушение правил общения  " },
    account = 3
  ) =>
    request(app.getHttpServer())
      .post(`/api/admin/reviews/${id}/${action}`)
      .set("Cookie", accounts[account]!.cookie)
      .set("Origin", origin)
      .send(body)
  it("модератор ищет отзывы с участниками и причиной без секретов", async () => {
    const { id, first } = await reviewPair()
    const result = await adminReviews(`bookingId=${id}`).expect(200)
    expect(result.headers["cache-control"]).toBe("no-store")
    expect(result.body).toMatchObject({ total: 2, page: 1, pageSize: 20 })
    expect(
      result.body.items.find((row: { id: string }) => row.id === first)
    ).toMatchObject({
      id: first,
      bookingId: id,
      authorId: accounts[1]!.id,
      recipientId: driver,
      recipientRole: "DRIVER",
      bookingStatus: "COMPLETED",
      rideStatus: "COMPLETED",
      hiddenAt: null,
      hiddenReason: null,
      author: { id: accounts[1]!.id, fullName: "Анна Соколова" },
    })
    expect(JSON.stringify(result.body)).not.toMatch(
      /passwordHash|tokenHash|sessions|email|phone/
    )
    await moderate(first).expect(200)
    const filtered = await adminReviews(
      `bookingId=${id}&hidden=true&recipientRole=DRIVER&ratingMin=4&ratingMax=5&authorId=${accounts[1]!.id}&recipientId=${driver}&q=${encodeURIComponent("нарушение правил")}`
    ).expect(200)
    expect(filtered.body.total).toBe(1)
    expect(filtered.body.items[0]).toMatchObject({
      id: first,
      hiddenReason: "Нарушение правил общения",
    })
    expect(
      (await adminReviews(`bookingId=${id}&hidden=false`).expect(200)).body
        .total
    ).toBe(1)
    expect(
      (await adminReviews(`bookingId=${id}&q=%25`).expect(200)).body.total
    ).toBe(0)
  })
  it("фильтрует даты включительно и стабильно сортирует страницы", async () => {
    const { id, first, second } = await reviewPair()
    await prisma.review.updateMany({
      where: { id: { in: [first, second] } },
      data: { createdAt: new Date("2026-11-01T12:00:00Z") },
    })
    const query = `bookingId=${id}&dateFrom=2026-11-01T12:00:00Z&dateTo=2026-11-01T12:00:00Z`
    expect((await adminReviews(query).expect(200)).body.total).toBe(2)
    const ids = [first, second].sort()
    for (const [index, id] of ids.entries())
      expect(
        (
          await adminReviews(
            `${query}&sort=oldest&pageSize=1&page=${index + 1}`
          ).expect(200)
        ).body.items[0].id
      ).toBe(id)
    expect(
      (
        await adminReviews(
          `bookingId=${id}&dateTo=2020-01-01T00:00:00Z`
        ).expect(200)
      ).body.total
    ).toBe(0)
    expect(
      (await adminReviews(`bookingId=${id}&page=99&pageSize=1`).expect(200))
        .body
    ).toMatchObject({ items: [], total: 2, page: 99 })
  })
  it("скрытие и восстановление меняют оба рейтинга и публичную карточку без удаления отзыва", async () => {
    const { first, second, id } = await reviewPair()
    const upcoming = await prisma.ride.create({
      data: {
        driverId: driver,
        vehicleId: vehicle,
        originId: start,
        destinationId: finish,
        departureAt: new Date("2099-11-09"),
        seatsTotal: 3,
        priceKopecks: 15015,
        status: "PUBLISHED",
      },
    })
    rides.push(upcoming.id)
    const hide = await moderate(first).expect(200)
    expect(hide.body).toMatchObject({
      id: first,
      changed: true,
      hiddenAt: expect.any(String),
      hiddenReason: "Нарушение правил общения",
    })
    expect((await ratings().expect(200)).body.driver).toEqual({
      average: null,
      count: 0,
    })
    expect((await publicReviews().expect(200)).body.total).toBe(0)
    expect(
      (await ownReviews(`direction=sent&bookingId=${id}`).expect(200)).body
        .total
    ).toBe(0)
    const card = await request(app.getHttpServer())
      .get(`/api/rides/${upcoming.id}`)
      .expect(200)
    expect(card.body.driver).toMatchObject({ rating: null, reviewCount: 0 })
    await review(id).expect(409)
    const restored = await moderate(first, "restore", {
      reason: "Контекст проверен, нарушения нет",
    }).expect(200)
    expect(restored.body).toEqual({
      id: first,
      changed: true,
      hiddenAt: null,
      hiddenReason: null,
    })
    expect((await ratings().expect(200)).body.driver).toEqual({
      average: 5,
      count: 1,
    })
    expect(
      (
        await request(app.getHttpServer())
          .get(`/api/rides/${upcoming.id}`)
          .expect(200)
      ).body.driver
    ).toMatchObject({ rating: 5, reviewCount: 1 })
    await moderate(second).expect(200)
    expect((await ratings(accounts[1]!.id).expect(200)).body.passenger).toEqual(
      { average: null, count: 0 }
    )
    await moderate(second, "restore", {
      reason: "Исправлена ошибка модерации",
    }).expect(200)
    expect((await ratings(accounts[1]!.id).expect(200)).body.passenger).toEqual(
      { average: 3, count: 1 }
    )
    expect(await prisma.review.count({ where: { bookingId: id } })).toBe(2)
    expect(
      await prisma.activityLog.findFirst({
        where: { resourceId: first, action: "review.restored" },
      })
    ).toMatchObject({
      actorId: accounts[3]!.id,
      details: expect.objectContaining({
        reason: "Контекст проверен, нарушения нет",
        fromHiddenAt: hide.body.hiddenAt,
        toHiddenAt: null,
      }),
    })
    expect(
      await prisma.notification.count({
        where: { resourceId: first, kind: "SYSTEM" },
      })
    ).toBe(6)
    for (const userId of [accounts[1]!.id, driver])
      expect(
        await prisma.notification.count({
          where: { resourceId: first, userId, kind: "SYSTEM" },
        })
      ).toBe(2)
  })
  it("параллельное скрытие и повторные команды не дублируют уведомления и сохраняют первую причину", async () => {
    const { first } = await reviewPair()
    const results = await Promise.all([moderate(first), moderate(first)])
    expect(results.map((r) => r.status)).toEqual([200, 200])
    expect(results.filter((r) => r.body.changed)).toHaveLength(1)
    const hiddenAt = results[0].body.hiddenAt
    const repeat = await moderate(first, "hide", {
      reason: "Другая причина",
    }).expect(200)
    expect(repeat.body).toMatchObject({
      hiddenAt,
      hiddenReason: "Нарушение правил общения",
      changed: false,
    })
    expect(
      await prisma.activityLog.count({
        where: { action: "review.hidden", resourceId: first },
      })
    ).toBe(1)
    expect(
      await prisma.notification.count({
        where: { kind: "SYSTEM", resourceId: first },
      })
    ).toBe(3)
    await moderate(first, "restore", { reason: "Проверено" }).expect(200)
    expect(
      (await moderate(first, "restore", { reason: "Повтор" }).expect(200)).body
        .changed
    ).toBe(false)
    expect(
      await prisma.activityLog.count({
        where: { action: "review.restored", resourceId: first },
      })
    ).toBe(1)
  })
  it("видит в модерации отзыв некорректного исторического участия без включения в рейтинг", async () => {
    const { id, first } = await reviewPair()
    await prisma.booking.update({
      where: { id },
      data: { status: "CANCELLED" },
    })
    expect((await adminReviews(`bookingId=${id}`).expect(200)).body.total).toBe(
      2
    )
    await moderate(first).expect(200)
    await moderate(first, "restore", { reason: "Проверка" }).expect(200)
    expect((await ratings().expect(200)).body.driver.count).toBe(0)
  })
  it("проверяет ADMIN, сессию, Origin и отсутствие отзыва", async () => {
    const { first } = await reviewPair()
    await request(app.getHttpServer()).get("/api/admin/reviews").expect(401)
    for (const account of [0, 1, 2]) {
      await adminReviews("", account).expect(403)
      await moderate(first, "hide", { reason: "Проверка" }, account).expect(403)
    }
    await request(app.getHttpServer())
      .post(`/api/admin/reviews/${first}/hide`)
      .set("Cookie", accounts[3]!.cookie)
      .send({ reason: "Проверка" })
      .expect(403)
    await request(app.getHttpServer())
      .post(`/api/admin/reviews/${first}/hide`)
      .set("Cookie", accounts[3]!.cookie)
      .set("Origin", "https://example.org")
      .send({ reason: "Проверка" })
      .expect(403)
    await moderate(randomUUID()).expect(404)
    await moderate("bad").expect(400)
    await prisma.user.update({
      where: { id: accounts[3]!.id },
      data: { status: "BLOCKED" },
    })
    try {
      await adminReviews().expect(401)
      await moderate(first).expect(401)
    } finally {
      await prisma.user.update({
        where: { id: accounts[3]!.id },
        data: { status: "ACTIVE" },
      })
    }
  })
  it.each([
    {},
    { reason: " " },
    { reason: "а".repeat(501) },
    { reason: null },
    { reason: "Причина", hiddenAt: null },
  ])("проверяет обязательную причину обеих команд %j", async (body) => {
    const { first } = await reviewPair()
    await moderate(first, "hide", body).expect(400)
    await moderate(first, "restore", body).expect(400)
  })
  it.each([
    "hidden=maybe",
    "recipientRole=ADMIN",
    "ratingMin=0",
    "ratingMin=5&ratingMax=1",
    "dateFrom=bad",
    "dateFrom=2027-01-01T00:00:00Z&dateTo=2020-01-01T00:00:00Z",
    "authorId=bad",
    "bookingId=bad",
    "page=0",
    "pageSize=101",
    "direction=sent",
  ])("проверяет параметры модерации %s", async (query) => {
    await adminReviews(query).expect(400)
  })
  it("ошибка уведомления откатывает скрытие, аудит и изменение рейтинга", async () => {
    const { first } = await reviewPair()
    const spy = failNotificationWrite(2)
    try {
      await moderate(first).expect(503)
    } finally {
      spy.mockRestore()
    }
    expect(
      (await prisma.review.findUniqueOrThrow({ where: { id: first } })).hiddenAt
    ).toBeNull()
    expect((await ratings().expect(200)).body.driver.average).toBe(5)
    expect(
      await prisma.activityLog.count({
        where: { action: "review.hidden", resourceId: first },
      })
    ).toBe(0)
    expect(
      await prisma.notification.count({
        where: { kind: "SYSTEM", resourceId: first },
      })
    ).toBe(0)
  })
  it("ошибка журнала откатывает восстановление без уведомлений", async () => {
    const { first } = await reviewPair()
    const hidden = await moderate(first).expect(200)
    const original = prisma.$transaction.bind(prisma)
    const spy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>
    ) =>
      original(async (tx) =>
        callback(
          new Proxy(tx, {
            get(target, property, receiver) {
              if (property === "activityLog")
                return {
                  ...target.activityLog,
                  create: () => {
                    throw new Error("secret audit failure")
                  },
                }
              return Reflect.get(target, property, receiver)
            },
          })
        )
      )) as typeof prisma.$transaction)
    try {
      await moderate(first, "restore", { reason: "Проверка" }).expect(503)
    } finally {
      spy.mockRestore()
    }
    expect(
      (
        await prisma.review.findUniqueOrThrow({ where: { id: first } })
      ).hiddenAt?.toISOString()
    ).toBe(hidden.body.hiddenAt)
    expect((await ratings().expect(200)).body.driver.count).toBe(0)
    expect(
      await prisma.notification.count({
        where: { kind: "SYSTEM", resourceId: first },
      })
    ).toBe(3)
  })
  it("возвращает безопасный 503 при сбое чтения списка модерации", async () => {
    const spy = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(new Error("secret database error"))
    try {
      expect((await adminReviews().expect(503)).body.message).toBe(
        "Модерация отзывов временно недоступна"
      )
    } finally {
      spy.mockRestore()
    }
  })
  const adminActivity = (query = "", account = 3) =>
    request(app.getHttpServer())
      .get(`/api/admin/activity?${query}`)
      .set("Cookie", accounts[account]!.cookie)
  it("история администратора содержит только его решения с причиной и безопасными полями", async () => {
    const { first } = await reviewPair()
    await moderate(first).expect(200)
    await moderate(first, "restore", { reason: "Контекст проверен" }).expect(
      200
    )
    await prisma.activityLog.create({
      data: {
        actorId: accounts[0]!.id,
        action: "review.hidden",
        resourceType: "review",
        resourceId: first,
        details: { reason: "Чужое решение", token: "private-token" },
      },
    })
    const result = await adminActivity().expect(200)
    expect(result.headers["cache-control"]).toBe("no-store")
    expect(result.body.total).toBe(2)
    expect(result.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "review.restored",
          resourceType: "review",
          resourceId: first,
          reason: "Контекст проверен",
        }),
      ])
    )
    expect(JSON.stringify(result.body)).not.toMatch(
      /Чужое решение|private-token|details|email|password|token/
    )
    const filtered = await adminActivity(
      `q=${encodeURIComponent("Контекст")}&action=review.restored&resourceType=review&resourceId=${first}&dateFrom=2020-01-01T00:00:00Z&dateTo=2099-01-01T00:00:00Z`
    ).expect(200)
    expect(filtered.body.total).toBe(1)
    expect(
      (
        await adminActivity(`resourceId=${first}&page=99&pageSize=1`).expect(
          200
        )
      ).body
    ).toMatchObject({ items: [], total: 2, page: 99 })
    const oldest = await adminActivity("sort=oldest&pageSize=1").expect(200)
    expect(oldest.body.items[0].action).toBe("review.hidden")
    await request(app.getHttpServer()).get("/api/admin/activity").expect(401)
    await adminActivity("", 0).expect(403)
  })
  it.each([
    "actorId=" + randomUUID(),
    "resourceId=bad",
    "resourceType=session",
    "action=auth.login",
    "dateFrom=2027-01-01T00:00:00Z&dateTo=2020-01-01T00:00:00Z",
    "page=0",
  ])("история не принимает неверные и чужие фильтры %s", async (query) => {
    await adminActivity(query).expect(400)
  })
  it("история возвращает безопасную ошибку при сбое чтения", async () => {
    const spy = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(new Error("private database"))
    try {
      expect((await adminActivity().expect(503)).body.message).toBe(
        "История действий временно недоступна"
      )
    } finally {
      spy.mockRestore()
    }
  })
})
