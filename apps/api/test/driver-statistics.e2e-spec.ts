import "reflect-metadata"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import type { INestApplication } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { AppModule } from "../src/app.module.js"
import { PrismaService } from "../src/prisma/prisma.service.js"
import { configureApp } from "../src/setup.js"
import type {
  BookingStatus,
  PaymentStatus,
  RideStatus,
  Role,
} from "../src/generated/prisma/enums.js"
const domain = `${randomUUID()}.driver-statistics.campusride.test`
describe("Статистика водителя (HTTP + PostgreSQL)", () => {
  let app: INestApplication,
    prisma: PrismaService,
    district: string,
    origin: string,
    destination: string
  const accounts: { id: string; cookie: string }[] = [],
    cars: Record<number, string> = {},
    rides: string[] = [],
    bookings: string[] = []
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = module.createNestApplication()
    configureApp(app)
    prisma = app.get(PrismaService)
    await app.init()
    const roles: Role[] = ["DRIVER", "PASSENGER", "ADMIN", "DRIVER", "DRIVER"]
    for (const [i, role] of roles.entries()) {
      const token = randomBytes(32).toString("base64url")
      const user = await prisma.user.create({
        data: {
          email: `${i}@${domain}`,
          fullName: `Участник ${i}`,
          passwordHash: "test-only",
          roles: { create: { role } },
          sessions: {
            create: {
              tokenHash: createHash("sha256").update(token).digest("hex"),
              expiresAt: new Date(Date.now() + 3600000),
            },
          },
        },
      })
      accounts.push({ id: user.id, cookie: `campusride_session=${token}` })
      if (i === 0 || i === 3) {
        await prisma.driverProfile.create({ data: { userId: user.id } })
        cars[i] = (
          await prisma.vehicle.create({
            data: {
              driverId: user.id,
              make: "Kia",
              model: "Rio",
              color: "Белый",
              registrationNumber: randomUUID(),
              passengerSeats: 8,
            },
          })
        ).id
      }
    }
    district = (await prisma.district.create({ data: { name: domain } })).id
    origin = (
      await prisma.location.create({
        data: { districtId: district, name: "Уралмаш", address: "Космонавтов" },
      })
    ).id
    destination = (
      await prisma.location.create({
        data: { districtId: district, name: "УрФУ", address: "Мира, 19" },
      })
    ).id
    const statuses: RideStatus[] = [
      "COMPLETED",
      "COMPLETED",
      "PUBLISHED",
      "CANCELLED",
      "DRAFT",
      "IN_PROGRESS",
      "COMPLETED",
    ]
    for (const [i, status] of statuses.entries()) {
      const driver = i === 6 ? 3 : 0
      const departureAt =
        i === 2
          ? new Date("2099-11-09T03:00:00Z")
          : new Date(`2026-11-0${i + 1}T03:00:00Z`)
      const ride = await prisma.ride.create({
        data: {
          driverId: accounts[driver]!.id,
          vehicleId: cars[driver]!,
          originId: origin,
          destinationId: destination,
          departureAt,
          seatsTotal: 8,
          priceKopecks: 10000,
          status,
          startedAt: ["COMPLETED", "IN_PROGRESS"].includes(status)
            ? new Date("2026-10-01")
            : null,
          completedAt: status === "COMPLETED" ? new Date("2026-10-02") : null,
        },
      })
      rides.push(ride.id)
    }
    const specs: [
      number,
      number,
      number,
      number,
      BookingStatus,
      PaymentStatus,
    ][] = [
      [0, 1, 2, 10000, "COMPLETED", "SUCCEEDED"],
      [0, 3, 1, 10000, "COMPLETED", "SUCCEEDED"],
      [1, 1, 1, 15000, "COMPLETED", "SUCCEEDED"],
      [2, 1, 1, 20000, "CONFIRMED", "SUCCEEDED"],
      [2, 3, 1, 20000, "PENDING", "PENDING"],
      [3, 1, 2, 12000, "CANCELLED", "REFUNDED"],
      [3, 3, 1, 12000, "CANCELLED", "CANCELLED"],
      [2, 1, 1, 20000, "REJECTED", "CANCELLED"],
      [5, 3, 1, 30000, "CONFIRMED", "SUCCEEDED"],
      [6, 1, 1, 99900, "COMPLETED", "SUCCEEDED"],
    ]
    for (const [ride, passenger, seats, price, status, payment] of specs) {
      const row = await prisma.booking.create({
        data: {
          rideId: rides[ride]!,
          passengerId: accounts[passenger]!.id,
          requestKey: randomUUID(),
          seats,
          unitPriceKopecks: price,
          status,
          payment: {
            create: {
              amountKopecks: BigInt(seats) * BigInt(price),
              status: payment,
              isDemo: true,
              paidAt: ["SUCCEEDED", "REFUNDED"].includes(payment)
                ? new Date()
                : null,
              refundedAt: payment === "REFUNDED" ? new Date() : null,
            },
          },
        },
      })
      bookings.push(row.id)
    }
  })
  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.payment.deleteMany({
          where: { bookingId: { in: bookings } },
        })
        await prisma.booking.deleteMany({ where: { id: { in: bookings } } })
        await prisma.ride.deleteMany({ where: { id: { in: rides } } })
        const ids = accounts.map((a) => a.id)
        await prisma.vehicle.deleteMany({ where: { driverId: { in: ids } } })
        await prisma.driverProfile.deleteMany({
          where: { userId: { in: ids } },
        })
        await prisma.user.deleteMany({ where: { id: { in: ids } } })
        if (district) {
          await prisma.location.deleteMany({ where: { districtId: district } })
          await prisma.district.delete({ where: { id: district } })
        }
      }
    } finally {
      if (app) await app.close()
    }
  })
  const stats = (query = "", account = 0) =>
    request(app.getHttpServer())
      .get(`/api/me/driver-statistics?${query}`)
      .set("Cookie", accounts[account]!.cookie)
  it("считает поездки без размножения строк и отделяет пассажиров от мест", async () => {
    const result = await stats().expect(200)
    expect(result.headers["cache-control"]).toBe("no-store")
    expect(result.body).toEqual({
      dateFrom: null,
      dateTo: null,
      periodBasis: "departureAt",
      isDemo: true,
      currency: "RUB",
      ridesTotal: 6,
      draftRides: 1,
      publishedRides: 1,
      inProgressRides: 1,
      completedRides: 2,
      cancelledRides: 1,
      completedBookings: 3,
      passengersTransported: 2,
      seatsTransported: 4,
      cancelledBookings: 2,
      rejectedBookings: 1,
      demoReceiptsKopecks: "95000",
      demoCompletedRevenueKopecks: "45000",
      demoRefundsKopecks: "24000",
    })
    expect(JSON.stringify(result.body)).not.toMatch(
      /passengerId|bookingId|email|password|token/
    )
  })
  it("границы включительны и относятся к отправлению, а не созданию/оплате", async () => {
    const exact = await stats(
      "dateFrom=2026-11-02T08:00:00%2B05:00&dateTo=2026-11-02T08:00:00%2B05:00"
    ).expect(200)
    expect(exact.body).toMatchObject({
      dateFrom: "2026-11-02T03:00:00.000Z",
      dateTo: "2026-11-02T03:00:00.000Z",
      ridesTotal: 1,
      completedBookings: 1,
      passengersTransported: 1,
      seatsTransported: 1,
      demoReceiptsKopecks: "15000",
      demoRefundsKopecks: "0",
    })
    const range = await stats(
      "dateFrom=2026-11-01T03:00:00Z&dateTo=2026-11-02T03:00:00Z"
    ).expect(200)
    expect(range.body).toMatchObject({
      ridesTotal: 2,
      completedBookings: 3,
      seatsTransported: 4,
      demoReceiptsKopecks: "45000",
    })
    expect(
      (await stats("dateTo=2026-11-01T03:00:00Z").expect(200)).body.ridesTotal
    ).toBe(1)
  })
  it("будущая подтверждённая оплата не является выручкой завершённой поездки", async () => {
    const future = (await stats("dateFrom=2099-01-01T00:00:00Z").expect(200))
      .body
    expect(future).toMatchObject({
      ridesTotal: 1,
      publishedRides: 1,
      completedBookings: 0,
      passengersTransported: 0,
      seatsTransported: 0,
      demoReceiptsKopecks: "20000",
      demoCompletedRevenueKopecks: "0",
    })
  })
  it("возвраты показываются отдельно и не вычитаются повторно", async () => {
    const result = (
      await stats(
        "dateFrom=2026-11-04T03:00:00Z&dateTo=2026-11-04T03:00:00Z"
      ).expect(200)
    ).body
    expect(result).toMatchObject({
      ridesTotal: 1,
      cancelledRides: 1,
      cancelledBookings: 2,
      demoReceiptsKopecks: "0",
      demoCompletedRevenueKopecks: "0",
      demoRefundsKopecks: "24000",
    })
  })
  it("другой водитель видит только свою статистику, без профиля/поездок возвращаются нули", async () => {
    expect((await stats("", 3).expect(200)).body).toMatchObject({
      ridesTotal: 1,
      completedRides: 1,
      seatsTransported: 1,
      demoReceiptsKopecks: "99900",
    })
    const empty = (await stats("", 4).expect(200)).body
    expect(empty).toMatchObject({
      ridesTotal: 0,
      completedRides: 0,
      passengersTransported: 0,
      seatsTransported: 0,
      demoReceiptsKopecks: "0",
      demoCompletedRevenueKopecks: "0",
      demoRefundsKopecks: "0",
    })
    expect(
      (await stats("dateTo=2000-01-01T00:00:00Z").expect(200)).body.ridesTotal
    ).toBe(0)
  })

  it("денежные суммы превышают 32-битное целое без потери точности", async () => {
    const extraRides: string[] = [],
      extraBookings: string[] = []
    try {
      for (let i = 0; i < 2; i++) {
        const r = await prisma.ride.create({
          data: {
            driverId: accounts[0]!.id,
            vehicleId: cars[0]!,
            originId: origin,
            destinationId: destination,
            departureAt: new Date("2020-12-01T03:00:00Z"),
            seatsTotal: 8,
            priceKopecks: 2147483647,
            status: "COMPLETED",
            startedAt: new Date("2020-12-01T03:00:00Z"),
            completedAt: new Date("2020-12-01T04:00:00Z"),
          },
        })
        extraRides.push(r.id)
        rides.push(r.id)
        const booking = await prisma.booking.create({
          data: {
            rideId: r.id,
            passengerId: accounts[1]!.id,
            requestKey: randomUUID(),
            seats: 8,
            unitPriceKopecks: 2147483647,
            status: "COMPLETED",
            payment: {
              create: {
                amountKopecks: 17179869176n,
                status: "SUCCEEDED",
                isDemo: true,
                paidAt: new Date("2020-12-01T03:00:00Z"),
              },
            },
          },
        })
        extraBookings.push(booking.id)
        bookings.push(booking.id)
      }
      expect(
        (
          await stats(
            "dateFrom=2020-12-01T03:00:00Z&dateTo=2020-12-01T03:00:00Z"
          ).expect(200)
        ).body.demoReceiptsKopecks
      ).toBe("34359738352")
    } finally {
      await prisma.payment.deleteMany({
        where: { bookingId: { in: extraBookings } },
      })
      await prisma.booking.deleteMany({ where: { id: { in: extraBookings } } })
      await prisma.ride.deleteMany({ where: { id: { in: extraRides } } })
    }
  })
  it("некорректная сумма оплаты не увеличивает поступления", async () => {
    const id = bookings[0]!
    await prisma.payment.update({
      where: { bookingId: id },
      data: { amountKopecks: 1 },
    })
    try {
      expect((await stats().expect(200)).body.demoReceiptsKopecks).toBe("75000")
    } finally {
      await prisma.payment.update({
        where: { bookingId: id },
        data: { amountKopecks: 20000 },
      })
    }
  })
  it("требует DRIVER и активную сессию", async () => {
    await request(app.getHttpServer())
      .get("/api/me/driver-statistics")
      .expect(401)
    await stats("", 1).expect(403)
    await stats("", 2).expect(403)
    await prisma.user.update({
      where: { id: accounts[0]!.id },
      data: { status: "BLOCKED" },
    })
    try {
      await stats().expect(401)
    } finally {
      await prisma.user.update({
        where: { id: accounts[0]!.id },
        data: { status: "ACTIVE" },
      })
    }
  })
  it.each([
    "driverId=" + randomUUID(),
    "userId=" + randomUUID(),
    "dateFrom=bad",
    "dateTo=2026-11-05",
    "dateFrom=2027-01-01T00:00:00Z&dateTo=2026-01-01T00:00:00Z",
    "status=COMPLETED",
    "page=1",
  ])("проверяет период и запрещает подмену водителя %s", async (query) => {
    await stats(query).expect(400)
  })
  it("ошибка БД не раскрывает детали и не возвращает частичные итоги", async () => {
    const spy = vi
      .spyOn(prisma, "$queryRaw")
      .mockRejectedValueOnce(new Error("private connection"))
    try {
      expect((await stats().expect(503)).body.message).toBe(
        "Статистика водителя временно недоступна"
      )
    } finally {
      spy.mockRestore()
    }
  })
})
