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
import type { Prisma } from "../src/generated/prisma/client.js"
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
    await prisma.notification.deleteMany({
      where: { userId: { in: [userId, otherId] } },
    })
    await prisma.vehicle.update({
      where: { id: vehicleId },
      data: { passengerSeats: 3 },
    })
    await prisma.booking.deleteMany({
      where: { ride: { driverId: { in: [userId, otherId] } } },
    })
    await prisma.rideStatusEvent.deleteMany({
      where: { ride: { driverId: { in: [userId, otherId] } } },
    })
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

  it("публикует создание, публикацию, поиск и публичную карточку в Swagger", async () => {
    const result = await request(app.getHttpServer())
      .get("/api/docs-json")
      .expect(200)
    expect(result.body.paths["/api/rides"].post).toBeDefined()
    expect(result.body.paths["/api/rides"].get).toBeDefined()
    expect(result.body.paths["/api/rides/{id}"].get).toBeDefined()
    expect(result.body.paths["/api/rides/{id}/publish"].post).toBeDefined()
  })
  function list(query: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .get("/api/me/rides")
      .set("Cookie", cookie)
      .query(query)
  }
  function detail(id: string) {
    return request(app.getHttpServer())
      .get(`/api/me/rides/${id}`)
      .set("Cookie", cookie)
  }
  function patch(id: string, input: unknown) {
    return request(app.getHttpServer())
      .patch(`/api/rides/${id}`)
      .set("Cookie", cookie)
      .set("Origin", "http://localhost:5173")
      .send(input as object)
  }
  function remove(id: string) {
    return request(app.getHttpServer())
      .delete(`/api/rides/${id}`)
      .set("Cookie", cookie)
      .set("Origin", "http://localhost:5173")
  }

  it("получает свою поездку и список без утечки чужих черновиков", async () => {
    await list()
      .expect("Cache-Control", "no-store")
      .expect(200, { items: [], total: 0, page: 1, pageSize: 20 })
    const own = await create().expect(201)
    const other = await prisma.ride.create({
      data: {
        driverId: otherId,
        vehicleId: otherVehicleId,
        originId,
        destinationId,
        departureAt: new Date(Date.now() + 86400000),
        seatsTotal: 1,
        priceKopecks: 0,
      },
    })
    await detail(own.body.id)
      .expect("Cache-Control", "no-store")
      .expect(200, own.body)
    expect((await list().expect(200)).body.items).toEqual([own.body])
    const denied = await detail(other.id).expect(404)
    const missing = await detail(randomUUID()).expect(404)
    expect(denied.body).toEqual(missing.body)
    await patch(other.id, { conditions: "Чужое изменение" }).expect(404)
    await remove(other.id).expect(404)
    expect(
      (await prisma.ride.findUniqueOrThrow({ where: { id: other.id } }))
        .conditions
    ).toBeNull()
  })

  it("фильтрует свои поездки по статусу, автомобилю, точкам, цене, местам и времени", async () => {
    const first = await create(
      input({ conditions: "Утро, место для рюкзака" })
    ).expect(201)
    const laterAt = new Date(Date.now() + 172800000).toISOString()
    const second = await create(
      input({
        departureAt: laterAt,
        priceKopecks: 0,
        seatsTotal: 1,
        conditions: "Вечер",
      })
    ).expect(201)
    await prisma.ride.update({
      where: { id: second.body.id },
      data: { status: "PUBLISHED" },
    })
    const found = await list({
      q: "рюкЗАКА",
      status: "DRAFT",
      vehicleId,
      originId,
      destinationId,
      maxPriceKopecks: 15000,
      minSeats: 3,
      departureFrom: first.body.departureAt,
      departureTo: first.body.departureAt,
    }).expect(200)
    expect(found.body).toMatchObject({ total: 1, items: [first.body] })
    expect(
      (await list({ status: "PUBLISHED" }).expect(200)).body.items[0].id
    ).toBe(second.body.id)
    expect((await list({ q: "Kia" }).expect(200)).body.total).toBe(2)
    expect((await list({ q: "Космонавтов" }).expect(200)).body.total).toBe(2)
    expect((await list({ q: "Корпус УрФУ" }).expect(200)).body.total).toBe(2)
    expect((await list({ maxPriceKopecks: 0 }).expect(200)).body.total).toBe(1)
    expect((await list({ minSeats: 2 }).expect(200)).body.total).toBe(1)
    expect(
      (await list({ vehicleId: otherVehicleId }).expect(200)).body.total
    ).toBe(0)
    expect((await list({ originId: stop1 }).expect(200)).body.total).toBe(0)
    const a = await list({ pageSize: 1 }).expect(200)
    const b = await list({ pageSize: 1, page: 2 }).expect(200)
    expect(a.body.items[0].id).toBe(first.body.id)
    expect(b.body.items[0].id).toBe(second.body.id)
    expect(a.body.total).toBe(2)
    expect(
      (await list({ sort: "departureDesc", pageSize: 1 }).expect(200)).body
        .items[0].id
    ).toBe(second.body.id)
    expect((await list({ page: 10 }).expect(200)).body.items).toEqual([])
  })

  it("частично меняет черновик без сброса настроек и остановок; явно заменяет и очищает остановки", async () => {
    const own = await create(
      input({
        musicAllowed: false,
        luggageAllowed: true,
        smokingAllowed: true,
        stops: [{ locationId: stop1 }, { locationId: stop2 }],
      })
    ).expect(201)
    const changed = await patch(own.body.id, {
      conditions: "  Новые условия  ",
      priceKopecks: 0,
    })
      .expect("Cache-Control", "no-store")
      .expect(200)
    expect(changed.body).toMatchObject({
      conditions: "Новые условия",
      priceKopecks: 0,
      status: "DRAFT",
      driverId: userId,
      musicAllowed: false,
      luggageAllowed: true,
      smokingAllowed: true,
      stops: own.body.stops,
    })
    const replaced = await patch(own.body.id, {
      stops: [{ locationId: stop2 }],
      luggageAllowed: false,
    }).expect(200)
    expect(replaced.body.stops).toEqual([
      { id: expect.any(String), locationId: stop2, position: 1 },
    ])
    expect(replaced.body.luggageAllowed).toBe(false)
    expect(
      (await patch(own.body.id, { stops: [] }).expect(200)).body.stops
    ).toEqual([])
    expect(
      await prisma.rideStop.count({ where: { rideId: own.body.id } })
    ).toBe(0)
  })

  it("проверяет объединённые поля и сохраняет исходные данные при ошибке редактирования", async () => {
    const own = await create(input({ stops: [{ locationId: stop1 }] })).expect(
      201
    )
    for (const fields of [
      { destinationId: originId },
      { originId: stop1 },
      { stops: [{ locationId: randomUUID() }] },
      { vehicleId: otherVehicleId },
      { seatsTotal: 4 },
      { departureAt: "2020-01-01T08:00:00Z" },
    ]) {
      await patch(own.body.id, {
        conditions: "Не должно сохраниться",
        ...fields,
      }).expect("vehicleId" in fields ? 404 : 400)
      const current = await detail(own.body.id).expect(200)
      expect(current.body).toEqual(own.body)
    }
  })

  it.each([
    { status: "PUBLISHED" },
    { driverId: randomUUID() },
    { seatsTotal: null },
    { conditions: null },
    { musicAllowed: null },
    { stops: null },
    { stops: [{ locationId: stop1, position: 7 }] },
  ])("не принимает служебные и null-поля PATCH: %j", async (fields) => {
    const own = await create().expect(201)
    await patch(own.body.id, fields).expect(400)
    await detail(own.body.id).expect(200, own.body)
  })

  it("последовательно объединяет параллельные изменения разных полей без потери данных", async () => {
    const own = await create().expect(201)
    const results = await Promise.all([
      patch(own.body.id, { conditions: "Параллельное изменение" }),
      patch(own.body.id, { priceKopecks: 0 }),
    ])
    expect(results.map(({ status }) => status)).toEqual([200, 200])
    expect((await detail(own.body.id).expect(200)).body).toMatchObject({
      conditions: "Параллельное изменение",
      priceKopecks: 0,
    })
  })

  it("удаляет свой черновик вместе с остановками и отвечает 404 при повторе", async () => {
    const own = await create(input({ stops: [{ locationId: stop1 }] })).expect(
      201
    )
    const result = await remove(own.body.id)
      .expect("Cache-Control", "no-store")
      .expect(204)
    expect(result.text).toBe("")
    await detail(own.body.id).expect(404)
    await remove(own.body.id).expect(404)
    expect(
      await prisma.rideStop.count({ where: { rideId: own.body.id } })
    ).toBe(0)
  })

  it.each(["PUBLISHED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const)(
    "не меняет и не удаляет поездку со статусом %s",
    async (status) => {
      const own = await create().expect(201)
      await prisma.ride.update({ where: { id: own.body.id }, data: { status } })
      await patch(own.body.id, { conditions: "Изменение" }).expect(409)
      await remove(own.body.id).expect(409)
      expect((await detail(own.body.id).expect(200)).body.status).toBe(status)
    }
  )

  it("не меняет и не удаляет черновик с бронированием любого статуса", async () => {
    const own = await create().expect(201)
    await prisma.booking.create({
      data: {
        rideId: own.body.id,
        passengerId: otherId,
        requestKey: randomUUID(),
        seats: 1,
        unitPriceKopecks: 100,
        status: "CANCELLED",
      },
    })
    await patch(own.body.id, { conditions: "Изменение" }).expect(409)
    await remove(own.body.id).expect(409)
    await detail(own.body.id).expect(200, own.body)
  })

  it.each([
    { status: "WRONG" },
    { vehicleId: "bad" },
    { page: 0 },
    { pageSize: 101 },
    { minSeats: 0 },
    { maxPriceKopecks: -1 },
    { departureFrom: "2027-01-01T08:00:00" },
    {
      departureFrom: "2028-01-01T08:00:00Z",
      departureTo: "2027-01-01T08:00:00Z",
    },
    { sort: "unknown" },
    { driverId: randomUUID() },
  ])("валидирует фильтры списка: %j", async (query) => {
    await list(query).expect(400)
  })

  it("закрывает все новые маршруты сессией, ролью и проверяет Origin на мутациях", async () => {
    const own = await create().expect(201)
    for (const [method, path] of [
      ["get", "/api/me/rides"],
      ["get", `/api/me/rides/${own.body.id}`],
      ["patch", `/api/rides/${own.body.id}`],
      ["delete", `/api/rides/${own.body.id}`],
    ] as const) {
      await request(app.getHttpServer())
        [method](path)
        .set("Origin", "http://localhost:5173")
        .expect(401)
    }
    for (const method of ["patch", "delete"] as const)
      await request(app.getHttpServer())
        [method](`/api/rides/${own.body.id}`)
        .set("Cookie", cookie)
        .set("Origin", "https://evil.example")
        .expect(403)
    await detail("bad").expect(400)
    await patch("bad", {}).expect(400)
    await remove("bad").expect(400)
    await prisma.userRole.deleteMany({ where: { userId, role: "DRIVER" } })
    await list().expect(403)
    await detail(own.body.id).expect(403)
    await patch(own.body.id, {}).expect(403)
    await remove(own.body.id).expect(403)
  })
  function publish(id: string, body?: unknown) {
    const call = request(app.getHttpServer())
      .post(`/api/rides/${id}/publish`)
      .set("Cookie", cookie)
      .set("Origin", "http://localhost:5173")
    return body === undefined ? call : call.send(body as object)
  }
  async function noPublication(id: string) {
    expect(
      (await prisma.ride.findUniqueOrThrow({ where: { id } })).status
    ).toBe("DRAFT")
    expect(await prisma.rideStatusEvent.count({ where: { rideId: id } })).toBe(
      0
    )
    expect(await prisma.notification.count({ where: { resourceId: id } })).toBe(
      0
    )
  }

  it("публикует поездку и атомарно создаёт событие статуса и уведомление водителю", async () => {
    const own = await create(input({ stops: [{ locationId: stop1 }] })).expect(
      201
    )
    const result = await publish(own.body.id)
      .expect("Cache-Control", "no-store")
      .expect(200)
    expect(result.body).toMatchObject({
      ...own.body,
      status: "PUBLISHED",
      updatedAt: expect.any(String),
    })
    const events = await prisma.rideStatusEvent.findMany({
      where: { rideId: own.body.id },
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      actorId: userId,
      fromStatus: "DRAFT",
      toStatus: "PUBLISHED",
    })
    const notifications = await prisma.notification.findMany({
      where: { resourceId: own.body.id },
    })
    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toMatchObject({
      userId,
      kind: "SYSTEM",
      title: "Поездка опубликована",
      resourceType: "ride",
      resourceId: own.body.id,
      readAt: null,
      link: "#/driver",
    })
    await patch(own.body.id, { conditions: "Поздняя правка" }).expect(409)
    await remove(own.body.id).expect(409)
  })

  it("повтор публикации не меняет время записи и не дублирует побочные действия", async () => {
    const own = await create().expect(201)
    const first = await publish(own.body.id, {}).expect(200)
    await publish(own.body.id).expect(200, first.body)
    await prisma.ride.update({
      where: { id: own.body.id },
      data: { departureAt: new Date(0) },
    })
    const current = await detail(own.body.id).expect(200)
    await publish(own.body.id).expect(200, current.body)
    expect(
      await prisma.rideStatusEvent.count({ where: { rideId: own.body.id } })
    ).toBe(1)
    expect(
      await prisma.notification.count({ where: { resourceId: own.body.id } })
    ).toBe(1)
  })

  it("три параллельные публикации создают только одно событие и уведомление", async () => {
    const own = await create().expect(201)
    const results = await Promise.all([
      publish(own.body.id),
      publish(own.body.id),
      publish(own.body.id),
    ])
    expect(results.map(({ status }) => status)).toEqual([200, 200, 200])
    expect(results[1]!.body).toEqual(results[0]!.body)
    expect(results[2]!.body).toEqual(results[0]!.body)
    expect(
      await prisma.rideStatusEvent.count({ where: { rideId: own.body.id } })
    ).toBe(1)
    expect(
      await prisma.notification.count({ where: { resourceId: own.body.id } })
    ).toBe(1)
  })

  it.each(["IN_PROGRESS", "COMPLETED", "CANCELLED"] as const)(
    "запрещает публикацию статуса %s",
    async (status) => {
      const own = await create().expect(201)
      await prisma.ride.update({ where: { id: own.body.id }, data: { status } })
      await publish(own.body.id).expect(409)
      expect(
        await prisma.rideStatusEvent.count({ where: { rideId: own.body.id } })
      ).toBe(0)
      expect(
        await prisma.notification.count({ where: { resourceId: own.body.id } })
      ).toBe(0)
    }
  )

  it("повторно проверяет истёкшее время, изменённую вместимость и заполненность условий", async () => {
    const own = await create().expect(201)
    await prisma.vehicle.update({
      where: { id: vehicleId },
      data: { passengerSeats: 2 },
    })
    await publish(own.body.id).expect(400)
    await noPublication(own.body.id)
    await prisma.vehicle.update({
      where: { id: vehicleId },
      data: { passengerSeats: 3 },
    })
    await prisma.ride.update({
      where: { id: own.body.id },
      data: { departureAt: new Date(0) },
    })
    await publish(own.body.id).expect(400)
    await noPublication(own.body.id)
    for (const conditions of [null, "   "]) {
      await prisma.ride.update({
        where: { id: own.body.id },
        data: { departureAt: new Date(Date.now() + 86400000), conditions },
      })
      await publish(own.body.id).expect(400)
      await noPublication(own.body.id)
    }
  })

  it("повторно проверяет автомобиль и точки маршрута с остановками", async () => {
    const own = await create().expect(201)
    await prisma.ride.update({
      where: { id: own.body.id },
      data: { vehicleId: otherVehicleId },
    })
    await publish(own.body.id).expect(404)
    await noPublication(own.body.id)
    await prisma.ride.update({
      where: { id: own.body.id },
      data: { vehicleId },
    })
    await prisma.rideStop.create({
      data: { rideId: own.body.id, locationId: originId, position: 1 },
    })
    await publish(own.body.id).expect(400)
    await noPublication(own.body.id)
  })

  it("не публикует черновик с бронированиями", async () => {
    const own = await create().expect(201)
    await prisma.booking.create({
      data: {
        rideId: own.body.id,
        passengerId: otherId,
        requestKey: randomUUID(),
        seats: 1,
        unitPriceKopecks: 100,
        status: "CANCELLED",
      },
    })
    await publish(own.body.id).expect(409)
    await noPublication(own.body.id)
  })

  it("ошибка уведомления откатывает реальную запись статуса и события, повтор после исправления успешен", async () => {
    const own = await create().expect(201)
    const real = prisma.$transaction.bind(prisma)
    let attemptedNotification = false
    const failingTransaction = ((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>
    ) =>
      real(async (tx) => {
        const failed = new Proxy(tx, {
          get(target, key) {
            if (key === "notification")
              return {
                ...target.notification,
                create: async () => {
                  attemptedNotification = true
                  throw new Error("private database credentials")
                },
              }
            return Reflect.get(target, key)
          },
        })
        return callback(failed)
      })) as typeof prisma.$transaction
    const transaction = vi
      .spyOn(prisma, "$transaction")
      .mockImplementationOnce(failingTransaction)
    try {
      const result = await publish(own.body.id).expect(503)
      expect(attemptedNotification).toBe(true)
      expect(result.body.message).toBe(
        "Не удалось опубликовать поездку. Повторите позже"
      )
      expect(result.text).not.toContain("private database credentials")
      await noPublication(own.body.id)
    } finally {
      transaction.mockRestore()
    }
    await publish(own.body.id).expect(200)
    expect(
      await prisma.rideStatusEvent.count({ where: { rideId: own.body.id } })
    ).toBe(1)
    expect(
      await prisma.notification.count({ where: { resourceId: own.body.id } })
    ).toBe(1)
  })

  it("сериализует публикацию и редактирование одного черновика", async () => {
    const own = await create().expect(201)
    const [published, edited] = await Promise.all([
      publish(own.body.id),
      patch(own.body.id, { conditions: "Новые условия" }),
    ])
    expect(published.status).toBe(200)
    expect([200, 409]).toContain(edited.status)
    const current = await detail(own.body.id).expect(200)
    expect(current.body.status).toBe("PUBLISHED")
    expect(current.body.conditions).toBe(
      edited.status === 200 ? "Новые условия" : own.body.conditions
    )
    expect(
      await prisma.rideStatusEvent.count({ where: { rideId: own.body.id } })
    ).toBe(1)
  })

  it.each([
    { status: "PUBLISHED" },
    { driverId: randomUUID() },
    { seatsTotal: 1 },
  ])("команда публикации не принимает поля: %j", async (body) => {
    const own = await create().expect(201)
    await publish(own.body.id, body).expect(400)
    await noPublication(own.body.id)
  })

  it("защищает публикацию владельцем, ролью, сессией и Origin", async () => {
    const own = await create().expect(201)
    await request(app.getHttpServer())
      .post(`/api/rides/${own.body.id}/publish`)
      .set("Origin", "http://localhost:5173")
      .expect(401)
    for (const origin of [undefined, "https://evil.example"]) {
      const call = request(app.getHttpServer())
        .post(`/api/rides/${own.body.id}/publish`)
        .set("Cookie", cookie)
      if (origin) call.set("Origin", origin)
      await call.expect(403)
    }
    const other = await prisma.ride.create({
      data: {
        driverId: otherId,
        vehicleId: otherVehicleId,
        originId,
        destinationId,
        departureAt: new Date(Date.now() + 86400000),
        seatsTotal: 1,
        priceKopecks: 0,
        conditions: "У входа",
      },
    })
    const foreign = await publish(other.id).expect(404)
    const missing = await publish(randomUUID()).expect(404)
    expect(foreign.body).toEqual(missing.body)
    await publish("bad").expect(400)
    await prisma.userRole.deleteMany({ where: { userId, role: "DRIVER" } })
    await prisma.userRole.create({ data: { userId, role: "ADMIN" } })
    await publish(own.body.id).expect(403)
    await prisma.user.update({
      where: { id: userId },
      data: { status: "BLOCKED" },
    })
    await publish(own.body.id).expect(401)
    await noPublication(own.body.id)
  })
})
