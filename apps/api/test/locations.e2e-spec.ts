import "reflect-metadata"
import { randomUUID } from "node:crypto"
import type { INestApplication } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { AppModule } from "../src/app.module.js"
import {
  seedRouteReferences,
  type RouteReferenceData,
} from "../src/demo/seed-routes.js"
import { PrismaService } from "../src/prisma/prisma.service.js"
import { configureApp } from "../src/setup.js"

const prefix = randomUUID()
const d1 = randomUUID(),
  d2 = randomUUID(),
  d3 = randomUUID()
const c1 = randomUUID(),
  c2 = randomUUID(),
  c3 = randomUUID()
const l1 = randomUUID(),
  l2 = randomUUID(),
  l3 = randomUUID(),
  l4 = randomUUID()
const data: RouteReferenceData = {
  districts: [
    { id: d1, name: `${prefix} Втузгородок` },
    { id: d2, name: `${prefix} Центр` },
    { id: d3, name: `${prefix} Пустой район` },
  ],
  campuses: [
    { id: c1, name: `${prefix} Мира` },
    { id: c2, name: `${prefix} Тургенева` },
    { id: c3, name: `${prefix} Без точек` },
  ],
  locations: [
    {
      id: l1,
      name: `${prefix} ГУК`,
      address: "Екатеринбург, Мира, 19",
      kind: "CAMPUS",
      districtId: d1,
      campusId: c1,
    },
    {
      id: l2,
      name: `${prefix} Встреча`,
      address: "Екатеринбург, Мира, 19",
      kind: "MEETING_POINT",
      districtId: d1,
      campusId: c1,
    },
    {
      id: l3,
      name: `${prefix} Метро`,
      address: "Екатеринбург, Баумана",
      kind: "TRANSIT_STOP",
      districtId: d2,
      campusId: null,
    },
    {
      id: l4,
      name: `${prefix} Корпус 2`,
      address: "Екатеринбург, Тургенева, 4",
      kind: "CAMPUS",
      districtId: d2,
      campusId: c2,
    },
  ],
}

describe("Справочники маршрутов (HTTP + PostgreSQL)", () => {
  let app: INestApplication
  let prisma: PrismaService
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = module.createNestApplication()
    configureApp(app)
    prisma = app.get(PrismaService)
    await app.init()
    await seedRouteReferences(prisma, data)
  })
  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.location.deleteMany({
          where: { id: { in: [l1, l2, l3, l4] } },
        })
        await prisma.campus.deleteMany({ where: { id: { in: [c1, c2, c3] } } })
        await prisma.district.deleteMany({
          where: { id: { in: [d1, d2, d3] } },
        })
      }
    } finally {
      if (app) await app.close()
    }
  })
  function get(path: string, query: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .get(`/api/${path}`)
      .query({ q: prefix, ...query })
  }

  it("публично выдаёт районы и корпуса с UUID, включая записи без точек", async () => {
    for (const path of ["districts", "campuses"]) {
      const result = await get(path).expect(200)
      expect(result.body).toMatchObject({ total: 3, page: 1, pageSize: 20 })
      expect(result.body.items).toHaveLength(3)
      expect(
        Object.keys(result.body.items[0]).sort((a, b) => a.localeCompare(b))
      ).toEqual(["id", "name"])
    }
  })

  it("ищет точки по названию и адресу, сочетая четыре фильтра через И", async () => {
    const result = await get("locations", {
      q: "гУк",
      districtId: d1,
      campusId: c1,
      kind: "CAMPUS",
      address: "мИрА",
    }).expect(200)
    expect(result.body.total).toBe(1)
    expect(result.body.items[0]).toEqual({
      ...data.locations[0],
      district: data.districts[0],
      campus: data.campuses[0],
    })
    expect(
      (await get("locations", { q: "баУмана", districtId: d2 }).expect(200))
        .body.items[0].campus
    ).toBeNull()
    expect(
      (
        await get("locations", { districtId: d1, kind: "TRANSIT_STOP" }).expect(
          200
        )
      ).body.total
    ).toBe(0)
    expect(
      (await get("locations", { campusId: c2 }).expect(200)).body.total
    ).toBe(1)
    expect(
      (await get("locations", { address: "Тургенева" }).expect(200)).body.total
    ).toBe(1)
  })

  it("пагинирует точки без повторов с согласованным total", async () => {
    const first = await get("locations", { pageSize: 2 }).expect(200)
    const second = await get("locations", { pageSize: 2, page: 2 }).expect(200)
    expect(first.body.total).toBe(4)
    expect(second.body.total).toBe(4)
    expect(first.body.items).toHaveLength(2)
    expect(second.body.items).toHaveLength(2)
    expect(
      new Set(
        [...first.body.items, ...second.body.items].map(
          (row: { id: string }) => row.id
        )
      ).size
    ).toBe(4)
    expect(
      (await get("locations", { page: 20 }).expect(200)).body.items
    ).toEqual([])
  })

  it("фильтрует районы и корпуса четырьмя параметрами одной связанной точки", async () => {
    const districts = await get("districts", {
      kind: "CAMPUS",
      address: "Мира",
      locationName: "ГУК",
      campusId: c1,
    }).expect(200)
    expect(districts.body.items).toEqual([data.districts[0]])
    const campuses = await get("campuses", {
      kind: "CAMPUS",
      address: "Тургенева",
      locationName: "Корпус",
      districtId: d2,
    }).expect(200)
    expect(campuses.body.items).toEqual([data.campuses[1]])
    for (const path of ["districts", "campuses"]) {
      expect(
        (
          await get(path, { kind: "CAMPUS", locationName: "Встреча" }).expect(
            200
          )
        ).body.total
      ).toBe(0)
      expect(
        (await get(path, { pageSize: 1, page: 2 }).expect(200)).body
      ).toMatchObject({ total: 3, page: 2, pageSize: 1 })
    }
  })

  it("возвращает пустой результат для корректного неизвестного UUID", async () => {
    expect(
      (await get("locations", { districtId: randomUUID() }).expect(200)).body
        .items
    ).toEqual([])
  })

  it.each(["districts", "campuses", "locations"])(
    "валидирует общие параметры %s",
    async (path) => {
      for (const query of [
        { page: 0 },
        { pageSize: 101 },
        { page: "1.5" },
        { page: "true" },
        { kind: "INVALID" },
        { q: "x".repeat(101) },
        { address: "x".repeat(201) },
        { userId: randomUUID() },
        { q: ["one", "two"] },
      ])
        await get(path, query).expect(400)
    }
  )

  it.each([
    ["locations", { districtId: "bad" }],
    ["locations", { campusId: "bad" }],
    ["districts", { campusId: "bad" }],
    ["campuses", { districtId: "bad" }],
  ])("валидирует UUID в %s: %j", async (path, query) => {
    await get(path as string, query as Record<string, unknown>).expect(400)
  })

  it("возвращает 503 без внутренних подробностей БД", async () => {
    const read = vi
      .spyOn(prisma.location, "findMany")
      .mockImplementationOnce(() => {
        throw new Error("private database credentials")
      })
    try {
      const result = await get("locations").expect(503)
      expect(result.body.message).toBe("Справочники временно недоступны")
      expect(result.text).not.toContain("private database credentials")
    } finally {
      read.mockRestore()
    }
  })

  it("публикует фактические маршруты в OpenAPI", async () => {
    const result = await request(app.getHttpServer())
      .get("/api/docs-json")
      .expect(200)
    for (const path of ["districts", "campuses", "locations"])
      expect(result.body.paths).toHaveProperty(`/api/${path}`)
  })

  it("повторный seed сохраняет UUID, количество и изменённые поля", async () => {
    await prisma.district.update({
      where: { id: d1 },
      data: { name: `${prefix} Изменённый район` },
    })
    await prisma.location.update({
      where: { id: l1 },
      data: { address: "Уточнённое место встречи" },
    })
    await seedRouteReferences(prisma, data)
    expect(
      await prisma.district.count({ where: { id: { in: [d1, d2, d3] } } })
    ).toBe(3)
    expect(
      await prisma.location.count({ where: { id: { in: [l1, l2, l3, l4] } } })
    ).toBe(4)
    expect(
      (await prisma.location.findUniqueOrThrow({ where: { id: l1 } })).address
    ).toBe("Уточнённое место встречи")
    expect(
      (await prisma.district.findUniqueOrThrow({ where: { id: d1 } })).name
    ).toBe(`${prefix} Изменённый район`)
  })

  it("повторно использует уже существующие одноимённые район и корпус с другими UUID", async () => {
    const alias = {
      ...data,
      districts: [{ ...data.districts[1]!, id: randomUUID() }],
      campuses: [{ ...data.campuses[1]!, id: randomUUID() }],
      locations: [],
    }
    await seedRouteReferences(prisma, alias)
    expect(
      await prisma.district.count({ where: { name: data.districts[1]!.name } })
    ).toBe(1)
    expect(
      await prisma.campus.count({ where: { name: data.campuses[1]!.name } })
    ).toBe(1)
  })

  it("ошибка ссылки в seed откатывает создание справочников", async () => {
    const id = randomUUID()
    await expect(
      seedRouteReferences(prisma, {
        districts: [{ id, name: `${prefix} Откат` }],
        campuses: [],
        locations: [
          { ...data.locations[0]!, id: randomUUID(), districtId: randomUUID() },
        ],
      })
    ).rejects.toThrow("Не найдена связь")
    expect(await prisma.district.findUnique({ where: { id } })).toBeNull()
  })
})
