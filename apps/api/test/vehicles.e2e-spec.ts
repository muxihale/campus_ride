import "reflect-metadata"
import { randomInt, randomUUID } from "node:crypto"
import type { INestApplication } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { Test } from "@nestjs/testing"
import request from "supertest"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppModule } from "../src/app.module.js"
import { PrismaService } from "../src/prisma/prisma.service.js"
import { configureApp } from "../src/setup.js"

function plate() {
  const letters = "ABEKMHOPCTYX"
  const letter = () => letters[randomInt(letters.length)]!
  return `${letter()}${randomInt(100, 1000)}${letter()}${letter()}${randomInt(100, 1000)}`
}

describe("Свои автомобили (HTTP + PostgreSQL)", () => {
  let app: INestApplication
  let prisma: PrismaService
  let domain: string
  let cookie: string
  let userId: string
  beforeEach(async () => {
    domain = `${randomUUID()}.campusride.test`
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = module.createNestApplication()
    app.get(ConfigService).set("WEB_ORIGIN", "http://localhost:5173")
    configureApp(app)
    prisma = app.get(PrismaService)
    await app.init()
    const actor = await register("driver")
    cookie = actor.cookie
    userId = actor.id
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
  async function register(name: string) {
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
    return {
      id: result.body.id as string,
      cookie: (result.headers["set-cookie"] as unknown as string[])[0]!.split(
        ";"
      )[0]!,
    }
  }
  function data(overrides: Record<string, unknown> = {}) {
    return {
      make: "Kia",
      model: "Rio",
      color: "Белый",
      registrationNumber: plate(),
      passengerSeats: 3,
      ...overrides,
    }
  }
  function create(body: unknown = data(), session = cookie) {
    return request(app.getHttpServer())
      .post("/api/me/vehicles")
      .set("Origin", "http://localhost:5173")
      .set("Cookie", session)
      .send(body as object)
  }
  function update(id: string, body: unknown, session = cookie) {
    return request(app.getHttpServer())
      .patch(`/api/me/vehicles/${id}`)
      .set("Origin", "http://localhost:5173")
      .set("Cookie", session)
      .send(body as object)
  }
  function list(query: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .get("/api/me/vehicles")
      .set("Cookie", cookie)
      .query(query)
  }

  it("возвращает пустой список и добавляет автомобиль водителю без профиля, не выдавая новых ролей", async () => {
    await list()
      .expect("Cache-Control", "no-store")
      .expect(200, { items: [], total: 0, page: 1, pageSize: 20 })
    const input = data({ make: " Kia ", color: " Белый " })
    const result = await create(input)
      .expect("Cache-Control", "no-store")
      .expect(201)
    expect(result.body).toEqual({
      ...input,
      make: "Kia",
      color: "Белый",
      id: expect.any(String),
      createdAt: expect.any(String),
    })
    expect(await prisma.driverProfile.count({ where: { userId } })).toBe(1)
    expect(await prisma.userRole.count({ where: { userId } })).toBe(2)
    expect((await list().expect(200)).body.items).toEqual([result.body])
  })

  it("поддерживает поиск, четыре фильтра с И, диапазон мест и пагинацию только своих автомобилей", async () => {
    const rio = await create(data()).expect(201)
    await create(
      data({ model: "Ceed", color: "Синий", passengerSeats: 4 })
    ).expect(201)
    await create(
      data({ make: "Toyota", model: "Corolla", passengerSeats: 2 })
    ).expect(201)
    const other = await register("other")
    await create(data(), other.cookie).expect(201)
    const filtered = await list({
      q: "riO",
      make: "kia",
      model: "rio",
      color: "бел",
      minSeats: 3,
      maxSeats: 3,
    }).expect(200)
    expect(filtered.body).toMatchObject({ total: 1, items: [rio.body] })
    expect(
      (await list({ q: "kia", color: "синий" }).expect(200)).body.total
    ).toBe(1)
    expect((await list({ minSeats: 4 }).expect(200)).body.total).toBe(1)
    expect((await list({ maxSeats: 2 }).expect(200)).body.total).toBe(1)
    const first = await list({ pageSize: 2 }).expect(200)
    const second = await list({ pageSize: 2, page: 2 }).expect(200)
    expect(first.body.total).toBe(3)
    expect(second.body.total).toBe(3)
    expect(first.body.items).toHaveLength(2)
    expect(second.body.items).toHaveLength(1)
    expect(
      new Set(
        [...first.body.items, ...second.body.items].map(
          (item: { id: string }) => item.id
        )
      ).size
    ).toBe(3)
    expect((await list({ page: 10 }).expect(200)).body.items).toEqual([])
  })

  it("нормализует госномер при создании, поиске и редактировании", async () => {
    const canonical = plate()
    const result = await create(
      data({ registrationNumber: ` ${canonical.toLowerCase()} ` })
    ).expect(201)
    expect(result.body.registrationNumber).toBe(canonical)
    const cyrillic = canonical
      .replaceAll("A", "а")
      .replaceAll("B", "в")
      .replaceAll("C", "с")
    expect((await list({ q: cyrillic }).expect(200)).body.total).toBe(1)
    const changed = await update(result.body.id, {
      color: " Чёрный ",
      passengerSeats: 8,
    }).expect(200)
    expect(changed.body).toEqual({
      ...result.body,
      color: "Чёрный",
      passengerSeats: 8,
    })
    await update(result.body.id, { registrationNumber: cyrillic }).expect(200)
    expect(await prisma.vehicle.count({ where: { driverId: userId } })).toBe(1)
  })

  it("не показывает чужие автомобили и одинаково отвечает 404 на чужой и несуществующий UUID", async () => {
    const other = await register("other")
    const vehicle = await create(data(), other.cookie).expect(201)
    const denied = await update(vehicle.body.id, {
      color: "Изменённый",
    }).expect(404)
    const missing = await update(randomUUID(), { color: "Изменённый" }).expect(
      404
    )
    expect(denied.body).toEqual(missing.body)
    expect((await list().expect(200)).body.total).toBe(0)
    expect(
      (
        await prisma.vehicle.findUniqueOrThrow({
          where: { id: vehicle.body.id },
        })
      ).color
    ).toBe("Белый")
  })

  it("откатывает конфликт госномера при добавлении и частичном изменении", async () => {
    const other = await register("other")
    const taken = await create(data(), other.cookie).expect(201)
    await create(
      data({ registrationNumber: taken.body.registrationNumber.toLowerCase() })
    ).expect(409)
    expect(await prisma.driverProfile.count({ where: { userId } })).toBe(0)
    const own = await create().expect(201)
    await update(own.body.id, {
      color: "Красный",
      registrationNumber: taken.body.registrationNumber,
    }).expect(409)
    expect(
      (await prisma.vehicle.findUniqueOrThrow({ where: { id: own.body.id } }))
        .color
    ).toBe("Белый")
  })

  it("при параллельном добавлении одного номера сохраняет только один автомобиль", async () => {
    const input = data()
    const results = await Promise.all([create(input), create(input)])
    expect(results.map(({ status }) => status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ])
    expect(await prisma.vehicle.count({ where: { driverId: userId } })).toBe(1)
  })

  it("параллельно добавляет разные автомобили и сохраняет существующее описание водителя", async () => {
    const results = await Promise.all([create(), create()])
    expect(results.map(({ status }) => status)).toEqual([201, 201])
    expect(await prisma.driverProfile.count({ where: { userId } })).toBe(1)
    await prisma.driverProfile.update({
      where: { userId },
      data: { bio: "Езжу в УрФУ по будням" },
    })
    await create().expect(201)
    expect(
      (await prisma.driverProfile.findUniqueOrThrow({ where: { userId } })).bio
    ).toBe("Езжу в УрФУ по будням")
    expect(await prisma.vehicle.count({ where: { driverId: userId } })).toBe(3)
  })

  it.each([
    { driverId: randomUUID() },
    { id: randomUUID() },
    { passengerSeats: 0 },
    { passengerSeats: 9 },
    { passengerSeats: "3" },
    { passengerSeats: true },
    { make: " " },
    { color: null },
    { registrationNumber: "bad" },
  ])("валидирует создание: %j", async (fields) => {
    await create(data(fields)).expect(400)
    expect(await prisma.vehicle.count({ where: { driverId: userId } })).toBe(0)
  })

  it.each([
    { driverId: randomUUID() },
    { roles: ["ADMIN"] },
    { make: null },
    { color: " " },
    { passengerSeats: null },
    { passengerSeats: 1.5 },
  ])(
    "валидирует частичное изменение без сохранения остальных полей: %j",
    async (fields) => {
      const own = await create().expect(201)
      await update(own.body.id, { model: "Изменённая", ...fields }).expect(400)
      expect(
        (await prisma.vehicle.findUniqueOrThrow({ where: { id: own.body.id } }))
          .model
      ).toBe("Rio")
    }
  )

  it.each([
    { page: 0 },
    { pageSize: 101 },
    { page: "true" },
    { page: "1.5" },
    { minSeats: 0 },
    { maxSeats: 9 },
    { minSeats: 4, maxSeats: 2 },
    { driverId: randomUUID() },
  ])("валидирует параметры списка: %j", async (query) => {
    await list(query).expect(400)
  })

  it("требует DRIVER, сессию и активный аккаунт на всех маршрутах", async () => {
    const id = randomUUID()
    await request(app.getHttpServer()).get("/api/me/vehicles").expect(401)
    await request(app.getHttpServer())
      .post("/api/me/vehicles")
      .set("Origin", "http://localhost:5173")
      .send(data())
      .expect(401)
    await request(app.getHttpServer())
      .patch(`/api/me/vehicles/${id}`)
      .set("Origin", "http://localhost:5173")
      .send({ color: "Белый" })
      .expect(401)
    await prisma.userRole.deleteMany({ where: { userId, role: "DRIVER" } })
    for (const role of ["PASSENGER", "ADMIN"] as const) {
      if (role === "ADMIN")
        await prisma.userRole.create({ data: { userId, role } })
      await list().expect(403)
      await create().expect(403)
      await update(id, { color: "Белый" }).expect(403)
    }
    await prisma.user.update({
      where: { id: userId },
      data: { status: "BLOCKED" },
    })
    await list().expect(401)
  })

  it("проверяет Origin на мутациях и формат UUID", async () => {
    for (const origin of [undefined, "https://evil.example"]) {
      for (const method of ["post", "patch"] as const) {
        const url =
          method === "post"
            ? "/api/me/vehicles"
            : `/api/me/vehicles/${randomUUID()}`
        const call = request(app.getHttpServer())
          [method](url)
          .set("Cookie", cookie)
        if (origin) call.set("Origin", origin)
        await call.send(data()).expect(403)
      }
    }
    await update("invalid-uuid", { color: "Белый" }).expect(400)
  })

  it("при сбое БД возвращает 503 без внутренних данных", async () => {
    const read = vi
      .spyOn(prisma.vehicle, "findMany")
      .mockImplementationOnce(() => {
        throw new Error("private database credentials")
      })
    try {
      const result = await list().expect(503)
      expect(result.body.message).toBe("Автомобили временно недоступны")
      expect(result.text).not.toContain("private database credentials")
    } finally {
      read.mockRestore()
    }
  })
})
