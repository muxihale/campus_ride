import "reflect-metadata"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { hash } from "@node-rs/argon2"
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
import type { Prisma } from "../src/generated/prisma/client.js"
import type {
  BookingStatus,
  RideStatus,
  Role,
} from "../src/generated/prisma/enums.js"
const domain = `${randomUUID()}.user-status.campusride.test`,
  origin = "http://localhost:5173",
  password = "CampusRide-test-2026"
describe("Блокировка пользователей (HTTP + PostgreSQL)", () => {
  let app: INestApplication,
    prisma: PrismaService,
    district: string,
    originLocation: string,
    location: string
  const accounts: { id: string; cookie: string; tokenHash: string }[] = [],
    cars: Record<number, string> = {}
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = module.createNestApplication()
    app.get(ConfigService).set("WEB_ORIGIN", origin)
    app.get(ConfigService).set("NODE_ENV", "test")
    configureApp(app)
    prisma = app.get(PrismaService)
    await app.init()
    const passwordHash = await hash(password)
    for (let i = 0; i < 5; i++) {
      const token = randomBytes(32).toString("base64url"),
        tokenHash = createHash("sha256").update(token).digest("hex")
      const roles: Role[] =
        i === 0
          ? ["ADMIN"]
          : [1, 4].includes(i)
            ? ["PASSENGER", "DRIVER"]
            : ["PASSENGER"]
      const user = await prisma.user.create({
        data: {
          email: `${i}@${domain}`,
          fullName: `Участник ${i}`,
          passwordHash,
          roles: { create: roles.map((role) => ({ role })) },
        },
      })
      accounts.push({
        id: user.id,
        cookie: `campusride_session=${token}`,
        tokenHash,
      })
      if (roles.includes("DRIVER")) {
        await prisma.driverProfile.create({ data: { userId: user.id } })
        cars[i] = (
          await prisma.vehicle.create({
            data: {
              driverId: user.id,
              make: "Kia",
              model: "Rio",
              color: "Белый",
              registrationNumber: randomUUID(),
              passengerSeats: 4,
            },
          })
        ).id
      }
    }
    district = (await prisma.district.create({ data: { name: domain } })).id
    originLocation = (
      await prisma.location.create({
        data: { districtId: district, name: "Уралмаш", address: "Космонавтов" },
      })
    ).id
    location = (
      await prisma.location.create({
        data: { districtId: district, name: "УрФУ", address: "Мира, 19" },
      })
    ).id
  })
  async function clear() {
    const ids = accounts.map((account) => account.id)
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } })
    await prisma.activityLog.deleteMany({ where: { actorId: { in: ids } } })
    const where = { ride: { driverId: { in: ids } } }
    await prisma.bookingStatusEvent.deleteMany({ where: { booking: where } })
    await prisma.payment.deleteMany({ where: { booking: where } })
    await prisma.booking.deleteMany({ where })
    await prisma.rideStatusEvent.deleteMany({
      where: { ride: { driverId: { in: ids } } },
    })
    await prisma.ride.deleteMany({ where: { driverId: { in: ids } } })
  }
  beforeEach(async () => {
    await clear()
    await prisma.user.updateMany({
      where: { id: { in: accounts.map((a) => a.id) } },
      data: { status: "ACTIVE" },
    })
    for (const account of accounts)
      await prisma.session.upsert({
        where: { tokenHash: account.tokenHash },
        create: {
          userId: account.id,
          tokenHash: account.tokenHash,
          expiresAt: new Date(Date.now() + 3600000),
        },
        update: { expiresAt: new Date(Date.now() + 3600000) },
      })
  })
  afterAll(async () => {
    try {
      if (prisma) {
        await clear()
        const ids = accounts.map((a) => a.id)
        await prisma.vehicle.deleteMany({ where: { driverId: { in: ids } } })
        await prisma.driverProfile.deleteMany({
          where: { userId: { in: ids } },
        })
        await prisma.user.deleteMany({ where: { id: { in: ids } } })
        if (district)
          await prisma.location.deleteMany({ where: { districtId: district } })
        if (district) await prisma.district.delete({ where: { id: district } })
      }
    } finally {
      if (app) await app.close()
    }
  })
  const change = (
    target = 2,
    action = "block",
    body: object = { reason: "  Нарушение правил поездок  " },
    actor = 0
  ) =>
    request(app.getHttpServer())
      .post(`/api/admin/users/${accounts[target]!.id}/${action}`)
      .set("Cookie", accounts[actor]!.cookie)
      .set("Origin", origin)
      .send(body)
  const ride = (driver = 1, data: object = {}) =>
    prisma.ride.create({
      data: {
        driverId: accounts[driver]!.id,
        vehicleId: cars[driver]!,
        originId: originLocation,
        destinationId: location,
        departureAt: new Date("2099-11-09"),
        seatsTotal: 4,
        priceKopecks: 15000,
        status: "PUBLISHED",
        ...data,
      },
    })
  async function booking(
    rideId: string,
    passenger = 2,
    status: BookingStatus = "CONFIRMED"
  ) {
    return prisma.booking.create({
      data: {
        rideId,
        passengerId: accounts[passenger]!.id,
        requestKey: randomUUID(),
        seats: 1,
        unitPriceKopecks: 15000,
        status,
        payment: {
          create: {
            amountKopecks: 15000,
            status: status === "CONFIRMED" ? "SUCCEEDED" : "PENDING",
            paidAt: status === "CONFIRMED" ? new Date() : null,
          },
        },
      },
    })
  }
  it("блокирует пассажира, отзывает все сессии, отменяет заявки и возвращает оплату", async () => {
    const r = await ride(),
      first = await booking(r.id),
      secondRide = await ride(),
      second = await booking(secondRide.id, 2, "PENDING"),
      unaffected = await booking(r.id, 3)
    await prisma.session.create({
      data: {
        userId: accounts[2]!.id,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 3600000),
      },
    })
    const result = await change().expect(200)
    expect(result.headers["cache-control"]).toBe("no-store")
    expect(result.body).toMatchObject({
      id: accounts[2]!.id,
      status: "BLOCKED",
      changed: true,
      cancelledRides: 0,
      cancelledBookings: 2,
      revokedSessions: 2,
    })
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: first.id } }))
        .status
    ).toBe("CANCELLED")
    expect(
      (
        await prisma.payment.findUniqueOrThrow({
          where: { bookingId: first.id },
        })
      ).status
    ).toBe("REFUNDED")
    expect(
      (
        await prisma.payment.findUniqueOrThrow({
          where: { bookingId: second.id },
        })
      ).status
    ).toBe("CANCELLED")
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: unaffected.id } }))
        .status
    ).toBe("CONFIRMED")
    expect(
      (await prisma.ride.findUniqueOrThrow({ where: { id: r.id } })).status
    ).toBe("PUBLISHED")
    await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Cookie", accounts[2]!.cookie)
      .expect(401)
    await request(app.getHttpServer())
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email: `2@${domain}`, password })
      .expect(401)
    expect(
      await prisma.activityLog.findFirst({
        where: { action: "user.blocked", resourceId: accounts[2]!.id },
      })
    ).toMatchObject({
      actorId: accounts[0]!.id,
      details: expect.objectContaining({ reason: "Нарушение правил поездок" }),
    })
    expect(
      await prisma.notification.count({
        where: {
          userId: accounts[0]!.id,
          resourceType: "user",
          resourceId: accounts[2]!.id,
        },
      })
    ).toBe(1)
  })
  it("отменяет поездки водителя и его участия как пассажира, не затрагивая чужие заявки", async () => {
    const own = await ride(),
      draft = await ride(1, { status: "DRAFT" }),
      passengerRide = await ride(4)
    const first = await booking(own.id),
      second = await booking(own.id, 3, "PENDING"),
      ownPassenger = await booking(passengerRide.id, 1)
    const result = await change(1).expect(200)
    expect(result.body).toMatchObject({
      cancelledRides: 2,
      cancelledBookings: 3,
    })
    for (const id of [own.id, draft.id])
      expect(
        (await prisma.ride.findUniqueOrThrow({ where: { id } })).status
      ).toBe("CANCELLED")
    for (const id of [first.id, second.id, ownPassenger.id])
      expect(
        (await prisma.booking.findUniqueOrThrow({ where: { id } })).status
      ).toBe("CANCELLED")
    expect(
      (await prisma.ride.findUniqueOrThrow({ where: { id: passengerRide.id } }))
        .status
    ).toBe("PUBLISHED")
    expect(
      await prisma.bookingStatusEvent.count({
        where: { actorId: accounts[0]!.id, toStatus: "CANCELLED" },
      })
    ).toBe(3)
    expect(
      await prisma.notification.findFirst({
        where: { userId: accounts[2]!.id, kind: "RIDE_CANCELLED" },
      })
    ).toMatchObject({ title: "Поездка отменена администратором" })
  })
  it("разблокировка не возвращает сессии или отменённые участия; нужен новый вход", async () => {
    const r = await ride(),
      b = await booking(r.id)
    await change().expect(200)
    expect(
      (await change(2, "unblock", { reason: "Проверка завершена" }).expect(200))
        .body
    ).toMatchObject({
      status: "ACTIVE",
      changed: true,
      cancelledRides: 0,
      cancelledBookings: 0,
      revokedSessions: 0,
    })
    await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Cookie", accounts[2]!.cookie)
      .expect(401)
    await request(app.getHttpServer())
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email: `2@${domain}`, password })
      .expect(200)
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status
    ).toBe("CANCELLED")
    expect(
      await prisma.activityLog.count({
        where: { action: "user.unblocked", resourceId: accounts[2]!.id },
      })
    ).toBe(1)
  })
  it("параллельные и последовательные повторы не создают возвратов и уведомлений повторно", async () => {
    const r = await ride()
    await booking(r.id)
    const responses = await Promise.all([change(), change()])
    expect(responses.map((r) => r.status)).toEqual([200, 200])
    expect(responses.filter((r) => r.body.changed)).toHaveLength(1)
    const count = await prisma.notification.count({
      where: { userId: { in: accounts.map((a) => a.id) } },
    })
    expect((await change().expect(200)).body.changed).toBe(false)
    expect(
      await prisma.notification.count({
        where: { userId: { in: accounts.map((a) => a.id) } },
      })
    ).toBe(count)
    expect(
      await prisma.activityLog.count({ where: { action: "payment.refunded" } })
    ).toBeGreaterThanOrEqual(1)
    expect(
      await prisma.activityLog.count({
        where: { actorId: accounts[0]!.id, action: "payment.refunded" },
      })
    ).toBe(1)
    await change(2, "unblock").expect(200)
    expect((await change(2, "unblock").expect(200)).body.changed).toBe(false)
  })
  it.each(["IN_PROGRESS", "COMPLETED", "CANCELLED"] as RideStatus[])(
    "сохраняет поездку %s и её платежи",
    async (status) => {
      const r = await ride(1, {
        status,
        startedAt:
          status === "IN_PROGRESS" || status === "COMPLETED"
            ? new Date()
            : null,
        completedAt: status === "COMPLETED" ? new Date() : null,
      })
      const b = await booking(r.id),
        before = await prisma.payment.findUniqueOrThrow({
          where: { bookingId: b.id },
        })
      await change(1).expect(200)
      expect(
        (await prisma.ride.findUniqueOrThrow({ where: { id: r.id } })).status
      ).toBe(status)
      expect(
        await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } })
      ).toEqual(before)
    }
  )
  it("сохраняет прошедшую опубликованную поездку", async () => {
    const r = await ride(1, { departureAt: new Date("2020-01-01") })
    const b = await booking(r.id)
    await change(2).expect(200)
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status
    ).toBe("CONFIRMED")
  })
  it.each([
    {},
    { reason: " " },
    { reason: "а".repeat(501) },
    { reason: 1 },
    { reason: "Проверка", status: "ACTIVE" },
  ])("проверяет причину %j", async (body) => {
    await change(2, "block", body).expect(400)
    await change(2, "unblock", body).expect(400)
  })
  it("запрещает самоблокировку, чужие роли, отсутствие сессии и Origin", async () => {
    await change(0).expect(409)
    await change(2, "block", { reason: "Проверка" }, 1).expect(403)
    await request(app.getHttpServer())
      .post(`/api/admin/users/${accounts[2]!.id}/block`)
      .set("Origin", origin)
      .send({ reason: "Проверка" })
      .expect(401)
    await request(app.getHttpServer())
      .post(`/api/admin/users/${accounts[2]!.id}/block`)
      .set("Cookie", accounts[0]!.cookie)
      .send({ reason: "Проверка" })
      .expect(403)
    await request(app.getHttpServer())
      .post(`/api/admin/users/${randomUUID()}/block`)
      .set("Cookie", accounts[0]!.cookie)
      .set("Origin", origin)
      .send({ reason: "Проверка" })
      .expect(404)
    await request(app.getHttpServer())
      .post("/api/admin/users/bad/block")
      .set("Cookie", accounts[0]!.cookie)
      .set("Origin", origin)
      .send({ reason: "Проверка" })
      .expect(400)
  })
  it("некорректный платёж откатывает все уже выполненные отмены и блокировку", async () => {
    const r = await ride(),
      b = await booking(r.id),
      second = await booking(r.id, 3)
    await prisma.payment.update({
      where: { bookingId: second.id },
      data: { amountKopecks: 1 },
    })
    await change(1).expect(409)
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: accounts[1]!.id } }))
        .status
    ).toBe("ACTIVE")
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status
    ).toBe("CONFIRMED")
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } }))
        .status
    ).toBe("SUCCEEDED")
    expect(
      await prisma.session.count({ where: { userId: accounts[1]!.id } })
    ).toBe(1)
    expect(
      await prisma.activityLog.count({ where: { actorId: accounts[0]!.id } })
    ).toBe(0)
  })
  it.each(["notification", "activityLog"] as const)(
    "ошибка %s откатывает блокировку, сессии и возвраты",
    async (model) => {
      const r = await ride(),
        b = await booking(r.id)
      const original = prisma.$transaction.bind(prisma)
      const spy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(((
        callback: (tx: Prisma.TransactionClient) => Promise<unknown>
      ) =>
        original(async (tx) =>
          callback(
            new Proxy(tx, {
              get(target, property, receiver) {
                if (property === model)
                  return {
                    ...target[model],
                    create: (args: { data: { resourceType: string } }) => {
                      if (args.data.resourceType === "user")
                        throw new Error("secret write failure")
                      return model === "notification"
                        ? target.notification.create(
                            args as Prisma.NotificationCreateArgs
                          )
                        : target.activityLog.create(
                            args as Prisma.ActivityLogCreateArgs
                          )
                    },
                  }
                return Reflect.get(target, property, receiver)
              },
            })
          )
        )) as typeof prisma.$transaction)
      try {
        expect((await change().expect(503)).body.message).toBe(
          "Изменение блокировки временно недоступно"
        )
      } finally {
        spy.mockRestore()
      }
      expect(
        (
          await prisma.user.findUniqueOrThrow({
            where: { id: accounts[2]!.id },
          })
        ).status
      ).toBe("ACTIVE")
      expect(
        await prisma.session.count({ where: { userId: accounts[2]!.id } })
      ).toBe(1)
      expect(
        (await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } }))
          .status
      ).toBe("SUCCEEDED")
      expect(
        await prisma.notification.count({
          where: { userId: { in: accounts.map((a) => a.id) } },
        })
      ).toBe(0)
    }
  )
  it("гонка с новым бронированием не оставляет активных заявок заблокированного пассажира", async () => {
    const r = await ride()
    const results = await Promise.all([
      change(),
      request(app.getHttpServer())
        .post(`/api/rides/${r.id}/bookings`)
        .set("Cookie", accounts[2]!.cookie)
        .set("Origin", origin)
        .send({ seats: 1, requestKey: randomUUID() }),
    ])
    expect(results[0].status).toBe(200)
    expect([201, 401]).toContain(results[1].status)
    expect(
      await prisma.booking.count({
        where: {
          passengerId: accounts[2]!.id,
          status: { in: ["PENDING", "CONFIRMED"] },
        },
      })
    ).toBe(0)
  })
  it("гонка с подтверждением даёт отмену без повторного списания", async () => {
    const r = await ride(),
      b = await booking(r.id, 2, "PENDING")
    const results = await Promise.all([
      change(),
      request(app.getHttpServer())
        .post(`/api/bookings/${b.id}/confirm`)
        .set("Cookie", accounts[1]!.cookie)
        .set("Origin", origin)
        .send({}),
    ])
    expect(results[0].status).toBe(200)
    expect([200, 409]).toContain(results[1].status)
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status
    ).toBe("CANCELLED")
    expect(["CANCELLED", "REFUNDED"]).toContain(
      (await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } }))
        .status
    )
  })
  it.each(["booking", "ride"] as const)(
    "прошедший проверку сессии запрос %s не создаёт участие после блокировки",
    async (kind) => {
      const r = await ride()
      let entered!: () => void, release!: () => void
      const ready = new Promise<void>((resolve) => {
        entered = resolve
      })
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const original = prisma.$transaction.bind(prisma)
      const spy = vi
        .spyOn(prisma, "$transaction")
        .mockImplementationOnce((async (
          callback: (tx: Prisma.TransactionClient) => Promise<unknown>
        ) => {
          entered()
          await gate
          return original(callback)
        }) as typeof prisma.$transaction)
      const target = kind === "booking" ? 2 : 1
      const operation = request(app.getHttpServer())
        .post(kind === "booking" ? `/api/rides/${r.id}/bookings` : "/api/rides")
        .set("Cookie", accounts[target]!.cookie)
        .set("Origin", origin)
        .send(
          kind === "booking"
            ? { seats: 1, requestKey: randomUUID() }
            : {
                vehicleId: cars[1],
                originId: originLocation,
                destinationId: location,
                departureAt: "2099-11-09T03:00:00Z",
                seatsTotal: 3,
                priceKopecks: 15000,
                conditions: "Встреча у метро",
              }
        )
        .then((response) => response)
      await ready
      try {
        await change(target).expect(200)
      } finally {
        release()
      }
      try {
        expect((await operation).status).toBe(401)
      } finally {
        spy.mockRestore()
      }
      expect(
        await prisma.booking.count({
          where: {
            passengerId: accounts[target]!.id,
            status: { in: ["PENDING", "CONFIRMED"] },
          },
        })
      ).toBe(0)
      if (kind === "ride")
        expect(
          await prisma.ride.count({
            where: {
              driverId: accounts[1]!.id,
              status: { in: ["DRAFT", "PUBLISHED"] },
            },
          })
        ).toBe(0)
    }
  )
  it("гонка со стартом сохраняет либо начатую поездку, либо полный возврат", async () => {
    const r = await ride(),
      b = await booking(r.id)
    const results = await Promise.all([
      change(1),
      request(app.getHttpServer())
        .post(`/api/rides/${r.id}/start`)
        .set("Cookie", accounts[1]!.cookie)
        .set("Origin", origin)
        .send({}),
    ])
    expect(results[0].status).toBe(200)
    expect([200, 401]).toContain(results[1].status)
    const state = await prisma.ride.findUniqueOrThrow({ where: { id: r.id } })
    expect(["CANCELLED", "IN_PROGRESS"]).toContain(state.status)
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } }))
        .status
    ).toBe(state.status === "CANCELLED" ? "REFUNDED" : "SUCCEEDED")
  })
  it("два администратора не могут одновременно заблокировать друг друга", async () => {
    await prisma.userRole.create({
      data: { userId: accounts[4]!.id, role: "ADMIN" },
    })
    try {
      const results = await Promise.all([
        change(4),
        change(0, "block", { reason: "Проверка" }, 4),
      ])
      expect(results.filter((r) => r.status === 200)).toHaveLength(1)
      expect(results.filter((r) => r.status === 401)).toHaveLength(1)
      expect(
        await prisma.user.count({
          where: {
            id: { in: [accounts[0]!.id, accounts[4]!.id] },
            status: "ACTIVE",
          },
        })
      ).toBe(1)
    } finally {
      await prisma.userRole.delete({
        where: { userId_role: { userId: accounts[4]!.id, role: "ADMIN" } },
      })
    }
  })
})
