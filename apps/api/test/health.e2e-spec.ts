import "reflect-metadata"
import { type INestApplication } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { AppModule } from "../src/app.module.js"
import { PrismaService } from "../src/prisma/prisma.service.js"
import { configureApp } from "../src/setup.js"

describe("Интеграция HTTP API", () => {
  let app: INestApplication
  const query = vi.fn()

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: query })
      .compile()
    app = module.createNestApplication()
    configureApp(app)
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it("проверяет API без запроса к БД и разрешает origin фронтенда", async () => {
    await request(app.getHttpServer())
      .get("/api/health")
      .set("Origin", "http://localhost:5173")
      .expect("Access-Control-Allow-Origin", "http://localhost:5173")
      .expect(200, { status: "ok", service: "campusride-api" })
    expect(query).not.toHaveBeenCalled()
  })

  it("проверяет доступность БД отдельным запросом", async () => {
    query.mockResolvedValueOnce([{ "?column?": 1 }])
    await request(app.getHttpServer()).get("/api/health/ready").expect(200, {
      status: "ok",
      service: "campusride-api",
      database: "connected",
    })
    expect(query).toHaveBeenCalledOnce()
  })

  it("возвращает 503 при отказе БД без утечки внутренней ошибки", async () => {
    query.mockRejectedValueOnce(new Error("private connection details"))
    const response = await request(app.getHttpServer())
      .get("/api/health/ready")
      .expect(503)
    expect(response.body.message).toBe("База данных недоступна")
    expect(response.text).not.toContain("private connection details")
  })

  it("публикует OpenAPI с фактическими маршрутами", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/docs-json")
      .expect(200)
    expect(response.body.paths).toHaveProperty("/api/health")
    expect(response.body.paths).toHaveProperty("/api/health/ready")
  })
})
