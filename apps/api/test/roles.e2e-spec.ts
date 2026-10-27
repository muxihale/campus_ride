import "reflect-metadata"
import { randomUUID } from "node:crypto"
import { Controller, Get, type INestApplication } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { Test } from "@nestjs/testing"
import request from "supertest"
import { afterAll, beforeAll, describe, it } from "vitest"
import { AppModule } from "../src/app.module.js"
import { AuthModule } from "../src/auth/auth.module.js"
import { Roles } from "../src/auth/roles.decorator.js"
import { PrismaService } from "../src/prisma/prisma.service.js"
import { configureApp } from "../src/setup.js"

// Контроллер существует только в тестовом модуле, не в рабочем API.
@Controller("role-probe")
@Roles("ADMIN")
class RoleProbeController {
  @Get("admin")
  admin() {
    return { allowed: true }
  }

  @Get("driver")
  @Roles("DRIVER")
  driver() {
    return { allowed: true }
  }

  @Get("participant")
  @Roles("PASSENGER", "DRIVER")
  participant() {
    return { allowed: true }
  }
}

describe("Серверная проверка ролей (HTTP + PostgreSQL)", () => {
  let app: INestApplication
  let prisma: PrismaService
  const domain = `${randomUUID()}.campusride.test`
  const accounts: Record<string, { id: string; cookie: string }> = {}

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule, AuthModule],
      controllers: [RoleProbeController],
    }).compile()
    app = module.createNestApplication()
    app.get(ConfigService).set("WEB_ORIGIN", "http://localhost:5173")
    app.get(ConfigService).set("NODE_ENV", "test")
    configureApp(app)
    prisma = app.get(PrismaService)
    await app.init()
    for (const role of ["PASSENGER", "DRIVER", "ADMIN"] as const) {
      const response = await request(app.getHttpServer())
        .post("/api/auth/register")
        .set("Origin", "http://localhost:5173")
        .send({
          email: `${role.toLowerCase()}@${domain}`,
          password: "CampusRide-test-2026",
          fullName: "Анна Соколова",
        })
        .expect(201)
      accounts[role] = {
        id: response.body.id,
        cookie: (
          response.headers["set-cookie"] as unknown as string[]
        )[0]!.split(";")[0]!,
      }
      if (role !== "PASSENGER") {
        await prisma.userRole.deleteMany({
          where: { userId: response.body.id },
        })
        await prisma.userRole.create({
          data: { userId: response.body.id, role },
        })
      }
    }
  })

  afterAll(async () => {
    try {
      if (prisma)
        await prisma.user.deleteMany({
          where: { email: { endsWith: `@${domain}` } },
        })
    } finally {
      if (app) await app.close()
    }
  })

  it.each([
    ["PASSENGER", "admin", 403],
    ["PASSENGER", "driver", 403],
    ["PASSENGER", "participant", 200],
    ["DRIVER", "admin", 403],
    ["DRIVER", "driver", 200],
    ["DRIVER", "participant", 200],
    ["ADMIN", "admin", 200],
    ["ADMIN", "driver", 403],
    ["ADMIN", "participant", 403],
  ] as const)("%s → %s: %s", async (role, route, status) => {
    await request(app.getHttpServer())
      .get(`/api/role-probe/${route}`)
      .set("Cookie", accounts[role]!.cookie)
      .expect(status)
  })

  it("не доверяет ролям из заголовка и query без сессии", async () => {
    await request(app.getHttpServer())
      .get("/api/role-probe/admin?role=ADMIN")
      .set("X-Role", "ADMIN")
      .expect(401)
    await request(app.getHttpServer())
      .get("/api/role-probe/admin?role=ADMIN")
      .set("X-Role", "ADMIN")
      .set("Cookie", accounts.PASSENGER!.cookie)
      .expect(403)
  })

  it("учитывает совмещение и отзыв ролей в БД без перевхода", async () => {
    const account = accounts.PASSENGER!
    await prisma.userRole.create({
      data: { userId: account.id, role: "DRIVER" },
    })
    await request(app.getHttpServer())
      .get("/api/role-probe/driver")
      .set("Cookie", account.cookie)
      .expect(200)
    await prisma.userRole.deleteMany({
      where: { userId: account.id, role: "DRIVER" },
    })
    await request(app.getHttpServer())
      .get("/api/role-probe/driver")
      .set("Cookie", account.cookie)
      .expect(403)
  })

  it("истёкшая сессия не даёт доступ к разрешённой роли", async () => {
    const account = accounts.DRIVER!
    await prisma.session.updateMany({
      where: { userId: account.id },
      data: { expiresAt: new Date(0) },
    })
    await request(app.getHttpServer())
      .get("/api/role-probe/driver")
      .set("Cookie", account.cookie)
      .expect(401)
  })

  it("блокировка и удаление сессии запрещают доступ даже администратору", async () => {
    const account = accounts.ADMIN!
    await prisma.user.update({
      where: { id: account.id },
      data: { status: "BLOCKED" },
    })
    await request(app.getHttpServer())
      .get("/api/role-probe/admin")
      .set("Cookie", account.cookie)
      .expect(401)
    await prisma.user.update({
      where: { id: account.id },
      data: { status: "ACTIVE" },
    })
    await prisma.session.deleteMany({ where: { userId: account.id } })
    await request(app.getHttpServer())
      .get("/api/role-probe/admin")
      .set("Cookie", account.cookie)
      .expect(401)
  })
})
