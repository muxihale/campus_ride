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
    await prisma.bookingStatusEvent.deleteMany({
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
    expect(await prisma.payment.count({ where: { bookingId: id } })).toBe(0)
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
})
