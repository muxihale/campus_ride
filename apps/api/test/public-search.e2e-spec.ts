import "reflect-metadata"
import { randomInt, randomUUID } from "node:crypto"
import type { INestApplication } from "@nestjs/common"
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
import type { Prisma } from "../src/generated/prisma/client.js"
const prefix = randomUUID()
const districtId = randomUUID(),
  campusId = randomUUID(),
  originId = randomUUID(),
  destinationId = randomUUID()

describe("Публичный поиск (HTTP + PostgreSQL)", () => {
  let app: INestApplication, prisma: PrismaService
  const users: string[] = [],
    rides: string[] = []
  let toId: string, fromId: string
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = module.createNestApplication()
    configureApp(app)
    prisma = app.get(PrismaService)
    await app.init()
    await prisma.district.create({
      data: { id: districtId, name: `${prefix} Уралмаш` },
    })
    await prisma.campus.create({
      data: { id: campusId, name: `${prefix} УрФУ` },
    })
    await prisma.location.createMany({
      data: [
        {
          id: originId,
          name: `${prefix} Метро`,
          address: "Екатеринбург, Космонавтов",
          districtId,
          kind: "MEETING_POINT",
        },
        {
          id: destinationId,
          name: `${prefix} ГУК`,
          address: "Екатеринбург, Мира, 19",
          districtId,
          campusId,
          kind: "CAMPUS",
        },
      ],
    })
    for (const mode of ["active", "blocked", "revoked"]) {
      const user = await prisma.user.create({
        data: {
          email: `${mode}@${prefix}.campusride.test`,
          fullName: "Анна Соколова",
          phone: "+79123456789",
          passwordHash: "private-test-password-hash",
          status: mode === "blocked" ? "BLOCKED" : "ACTIVE",
          roles: {
            create: { role: mode === "revoked" ? "PASSENGER" : "DRIVER" },
          },
          driverProfile: {
            create: {
              vehicles: {
                create: {
                  make: "Kia",
                  model: "Rio",
                  color: "Белый",
                  registrationNumber: `A${randomInt(100, 1000)}BC${randomInt(100, 1000)}`,
                  passengerSeats: 3,
                },
              },
            },
          },
        },
        include: { driverProfile: { include: { vehicles: true } } },
      })
      users.push(user.id)
      const base = {
        driverId: user.id,
        vehicleId: user.driverProfile!.vehicles[0]!.id,
        originId,
        destinationId,
        departureAt: new Date("2099-11-09T03:00:00Z"),
        seatsTotal: 3,
        priceKopecks: 15000,
        conditions: `${prefix} Можно с рюкзаком`,
        status: "PUBLISHED" as const,
      }
      const add = async (
        overrides: Partial<Prisma.RideUncheckedCreateInput> = {}
      ) => {
        const row = await prisma.ride.create({
          data: { ...base, ...overrides },
        })
        rides.push(row.id)
        return row.id
      }
      if (mode !== "active") {
        await add()
        continue
      }
      toId = await add()
      fromId = await add({
        originId: destinationId,
        destinationId: originId,
        departureAt: new Date("2099-11-09T04:00:00Z"),
        priceKopecks: 0,
        seatsTotal: 1,
        musicAllowed: false,
        luggageAllowed: true,
      })
      await add({
        departureAt: new Date("2099-11-08T19:00:00Z"),
        priceKopecks: 30000,
      })
      await add({
        departureAt: new Date("2099-11-09T18:59:59.999Z"),
        priceKopecks: 30000,
      })
      await add({
        departureAt: new Date("2099-11-09T19:00:00Z"),
        priceKopecks: 30000,
      })
      await add({
        departureAt: new Date("2099-11-08T18:59:59.999Z"),
        priceKopecks: 30000,
      })
      for (const status of [
        "DRAFT",
        "IN_PROGRESS",
        "COMPLETED",
        "CANCELLED",
      ] as const)
        await add({ status })
      await add({ departureAt: new Date("2020-01-01T00:00:00Z") })
    }
  })
  afterEach(async () => {
    if (prisma)
      await prisma.booking.deleteMany({ where: { rideId: { in: rides } } })
  })
  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.booking.deleteMany({ where: { rideId: { in: rides } } })
        await prisma.ride.deleteMany({ where: { id: { in: rides } } })
        await prisma.vehicle.deleteMany({ where: { driverId: { in: users } } })
        await prisma.driverProfile.deleteMany({
          where: { userId: { in: users } },
        })
        await prisma.user.deleteMany({ where: { id: { in: users } } })
        await prisma.location.deleteMany({
          where: { id: { in: [originId, destinationId] } },
        })
        await prisma.campus.deleteMany({ where: { id: campusId } })
        await prisma.district.deleteMany({ where: { id: districtId } })
      }
    } finally {
      if (app) await app.close()
    }
  })
  const get = (query: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .get("/api/rides")
      .query({ q: prefix, ...query })

  it("без сессии показывает только будущие опубликованные поездки активного водителя с ролью DRIVER", async () => {
    const result = await get().expect("Cache-Control", "no-store").expect(200)
    expect(result.body).toMatchObject({ total: 6, page: 1, pageSize: 20 })
    for (const item of result.body.items)
      expect(item.driver).toEqual({ id: users[0], fullName: "Анна Соколова" })
    expect(result.text).not.toContain("private-test-password-hash")
    expect(result.text).not.toContain("+79123456789")
    expect(result.text).not.toContain("email")
    expect(result.text).not.toContain("registrationNumber")
    expect(result.body.items[0].vehicle).toEqual({
      make: "Kia",
      model: "Rio",
      color: "Белый",
    })
  })
  it("сочетает направление, район, корпус, день, время, цену и условия", async () => {
    const result = await get({
      direction: "TO_CAMPUS",
      originDistrictId: districtId,
      campusId,
      date: "2099-11-09",
      timeFrom: "08:00",
      timeTo: "08:00",
      maxPriceKopecks: 15000,
      minSeats: 3,
      musicAllowed: "true",
      luggageAllowed: "false",
      smokingAllowed: "false",
    }).expect(200)
    expect(result.body.total).toBe(1)
    expect(result.body.items[0].id).toBe(toId)
    const back = await get({
      direction: "FROM_CAMPUS",
      campusId,
      maxPriceKopecks: 0,
      minSeats: 1,
      musicAllowed: "false",
      luggageAllowed: "true",
    }).expect(200)
    expect(back.body.items.map((row: { id: string }) => row.id)).toEqual([
      fromId,
    ])
    expect((await get({ campusId }).expect(200)).body.total).toBe(6)
    expect((await get({ campusId: randomUUID() }).expect(200)).body.total).toBe(
      0
    )
  })
  it("учитывает полуночные границы Екатеринбурга, а не календарный день UTC", async () => {
    const result = await get({ date: "2099-11-09" }).expect(200)
    expect(result.body.total).toBe(4)
    expect(result.body.items[0].departureAt).toBe("2099-11-08T19:00:00.000Z")
    expect(result.body.items.at(-1).departureAt).toBe(
      "2099-11-09T18:59:59.999Z"
    )
    expect(
      (await get({ date: "2099-11-09", timeTo: "00:00" }).expect(200)).body
        .total
    ).toBe(1)
    expect((await get({ date: "2020-01-01" }).expect(200)).body.total).toBe(0)
  })
  it("ищет без учёта регистра по адресу, району, корпусу и условиям", async () => {
    for (const q of ["косМонавтов", "Уралмаш", "УрФУ", "рюкЗАКОМ"])
      expect((await get({ q, campusId }).expect(200)).body.total).toBe(6)
  })
  it("сортирует и пагинирует согласованно без повторов", async () => {
    const first = await get({ sort: "priceAsc", pageSize: 2 }).expect(200)
    const second = await get({ sort: "priceAsc", pageSize: 2, page: 2 }).expect(
      200
    )
    expect(first.body.items[0].id).toBe(fromId)
    expect(first.body.total).toBe(6)
    expect(second.body.total).toBe(6)
    expect(
      new Set(
        [...first.body.items, ...second.body.items].map(
          (row: { id: string }) => row.id
        )
      ).size
    ).toBe(4)
    expect(
      (await get({ sort: "priceDesc", pageSize: 1 }).expect(200)).body.items[0]
        .priceKopecks
    ).toBe(30000)
    expect((await get({ page: 100 }).expect(200)).body.items).toEqual([])
  })
  it.each([
    { status: "DRAFT" },
    { driverId: randomUUID() },
    { direction: "wrong" },
    { campusId: "bad" },
    { originDistrictId: "bad" },
    { date: "2099-02-30" },
    { date: "2099-11-09T00:00:00Z" },
    { timeFrom: "08:00" },
    { date: "2099-11-09", timeFrom: "25:00" },
    { date: "2099-11-09", timeFrom: "09:00", timeTo: "08:00" },
    { musicAllowed: "1" },
    { luggageAllowed: "FALSE" },
    { minSeats: 0 },
    { maxPriceKopecks: -1 },
    { page: 0 },
    { pageSize: 101 },
    { sort: "createdDesc" },
  ])("отклоняет неверные/служебные параметры: %j", async (query) => {
    await get(query).expect(400)
  })
  it("отвечает безопасным 503 при сбое поиска", async () => {
    const find = vi.spyOn(prisma, "$queryRaw").mockImplementationOnce(() => {
      throw new Error("private database credentials")
    })
    try {
      const result = await get().expect(503)
      expect(result.body.message).toBe("Поиск поездок временно недоступен")
      expect(result.text).not.toContain("private database credentials")
    } finally {
      find.mockRestore()
    }
  })
  async function book(
    rideId: string,
    status: "PENDING" | "CONFIRMED" | "CANCELLED" | "REJECTED" | "COMPLETED",
    seats: number,
    passengerId = users[1]!
  ) {
    return prisma.booking.create({
      data: {
        rideId,
        passengerId,
        requestKey: randomUUID(),
        status,
        seats,
        unitPriceKopecks: 100,
      },
    })
  }
  async function remaining(id: string) {
    const result = await get().expect(200)
    return result.body.items.find((item: { id: string }) => item.id === id)
      ?.availableSeats
  }

  it("без бронирований возвращает offered=available, не раскрывая заявки пассажиров", async () => {
    const result = await get().expect(200)
    for (const item of result.body.items) {
      expect(item.availableSeats).toBe(item.seatsTotal)
      expect(item).not.toHaveProperty("bookings")
    }
  })

  it("суммирует места PENDING и CONFIRMED, а не число бронирований", async () => {
    await book(toId, "PENDING", 1)
    await book(toId, "CONFIRMED", 1, users[2]!)
    expect(await remaining(toId)).toBe(1)
    expect(
      (await get({ minSeats: 2 }).expect(200)).body.items.some(
        (item: { id: string }) => item.id === toId
      )
    ).toBe(false)
    expect(
      (await get({ minSeats: 1 }).expect(200)).body.items.some(
        (item: { id: string }) => item.id === toId
      )
    ).toBe(true)
  })

  it("переход PENDING → CONFIRMED не занимает места повторно, отмена освобождает их", async () => {
    const booking = await book(toId, "PENDING", 2)
    expect(await remaining(toId)).toBe(1)
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: "CONFIRMED" },
    })
    expect(await remaining(toId)).toBe(1)
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: "CANCELLED" },
    })
    expect(await remaining(toId)).toBe(3)
  })

  it.each(["CANCELLED", "REJECTED", "COMPLETED"] as const)(
    "не вычитает места статуса %s",
    async (status) => {
      await book(toId, status, 3)
      expect(await remaining(toId)).toBe(3)
      expect(
        (await get({ minSeats: 3 }).expect(200)).body.items.some(
          (item: { id: string }) => item.id === toId
        )
      ).toBe(true)
    }
  )

  it("исключает полностью заполненные поездки даже без minSeats", async () => {
    await book(toId, "PENDING", 3)
    await book(fromId, "CONFIRMED", 1)
    const result = await get().expect(200)
    expect(result.body.total).toBe(4)
    expect(
      result.body.items.some((item: { id: string }) =>
        [toId, fromId].includes(item.id)
      )
    ).toBe(false)
  })

  it("скрывает поездку при ошибочном превышении вместимости, не возвращая отрицательный остаток", async () => {
    await book(toId, "PENDING", 2)
    await book(toId, "CONFIRMED", 2, users[2]!)
    const result = await get().expect(200)
    expect(result.body.total).toBe(5)
    expect(
      result.body.items.some((item: { id: string }) => item.id === toId)
    ).toBe(false)
    expect(
      result.body.items.every(
        (item: { availableSeats: number }) => item.availableSeats > 0
      )
    ).toBe(true)
  })

  it("применяет остаток до сортировки, LIMIT/OFFSET и total", async () => {
    await book(fromId, "CONFIRMED", 1)
    await book(toId, "PENDING", 2)
    const first = await get({ sort: "priceAsc", pageSize: 1 }).expect(200)
    const second = await get({ sort: "priceAsc", pageSize: 1, page: 2 }).expect(
      200
    )
    expect(first.body.total).toBe(5)
    expect(second.body.total).toBe(5)
    expect(first.body.items[0]).toMatchObject({ id: toId, availableSeats: 1 })
    expect(second.body.items).toHaveLength(1)
    expect(second.body.items[0].id).not.toBe(toId)
    const filtered = await get({ minSeats: 2, pageSize: 2 }).expect(200)
    expect(filtered.body.total).toBe(4)
    expect(filtered.body.items).toHaveLength(2)
    expect(
      filtered.body.items.every(
        (item: { availableSeats: number }) => item.availableSeats >= 2
      )
    ).toBe(true)
  })

  it("согласует строки и total при конкурентном появлении бронирования", async () => {
    const [result] = await Promise.all([
      get({
        direction: "TO_CAMPUS",
        date: "2099-11-09",
        timeFrom: "08:00",
        timeTo: "08:00",
        minSeats: 3,
      }).expect(200),
      book(toId, "PENDING", 1),
    ])
    expect(result.body.items).toHaveLength(result.body.total)
    expect([0, 1]).toContain(result.body.total)
    if (result.body.items.length)
      expect(result.body.items[0].availableSeats).toBe(3)
    expect(
      (
        await get({
          minSeats: 3,
          date: "2099-11-09",
          timeFrom: "08:00",
          timeTo: "08:00",
        }).expect(200)
      ).body.total
    ).toBe(0)
  })

  it("передаёт поисковый текст как параметр SQL", async () => {
    expect((await get({ q: "' OR true --" }).expect(200)).body.total).toBe(0)
  })
})
