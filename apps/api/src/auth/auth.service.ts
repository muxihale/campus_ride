import { createHash, randomBytes } from "node:crypto"
import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common"
import { hash, verify } from "@node-rs/argon2"
import { PrismaService } from "../prisma/prisma.service.js"
import { Prisma } from "../generated/prisma/client.js"
import type { CurrentUserDto, LoginDto, RegisterDto } from "./auth.dto.js"

export const SESSION_COOKIE = "campusride_session"
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

const dummyPasswordHash = hash(randomBytes(32).toString("base64url"), {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
})

const publicUserSelect = {
  id: true,
  email: true,
  fullName: true,
  affiliation: true,
  roles: { select: { role: true } },
} satisfies Prisma.UserSelect

type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>

function toCurrentUser(user: PublicUser): CurrentUserDto {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    affiliation: user.affiliation,
    roles: user.roles.map(({ role }) => role),
  }
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

@Injectable()
export class AuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async register(input: RegisterDto) {
    const passwordHash = await hash(input.password, {
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    })
    const token = randomBytes(32).toString("base64url")
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
    try {
      // Вложенная запись Prisma атомарно создаёт аккаунт, роль и сессию.
      const user = await this.prisma.user.create({
        data: {
          email: input.email,
          passwordHash,
          fullName: input.fullName,
          affiliation: input.affiliation || null,
          roles: { create: { role: "PASSENGER" } },
          sessions: {
            create: { tokenHash: hashSessionToken(token), expiresAt },
          },
        },
        select: publicUserSelect,
      })
      return { user: toCurrentUser(user), token, expiresAt }
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("Аккаунт с таким email уже существует")
      }
      // Не передаём исходную ошибку с параметрами записи в HTTP-логи.
      throw new InternalServerErrorException(
        "Не удалось создать аккаунт. Повторите попытку позже"
      )
    }
  }

  async login(input: LoginDto) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email: input.email },
        select: { ...publicUserSelect, passwordHash: true, status: true },
      })
      // Для отсутствующего аккаунта тоже выполняем Argon2, не раскрывая наличие email.
      const valid = await verify(
        user?.passwordHash ?? (await dummyPasswordHash),
        input.password
      )
      if (!user || !valid || user.status !== "ACTIVE") {
        throw new UnauthorizedException("Неверный email или пароль")
      }
      const token = randomBytes(32).toString("base64url")
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
      await this.prisma.session.create({
        data: {
          userId: user.id,
          tokenHash: hashSessionToken(token),
          expiresAt,
        },
      })
      return { user: toCurrentUser(user), token, expiresAt }
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error
      throw new ServiceUnavailableException(
        "Сервис авторизации временно недоступен"
      )
    }
  }

  async logout(token: unknown): Promise<void> {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return
    try {
      await this.prisma.session.deleteMany({
        where: { tokenHash: hashSessionToken(token) },
      })
    } catch {
      throw new ServiceUnavailableException(
        "Сервис авторизации временно недоступен"
      )
    }
  }

  async currentUser(token: unknown): Promise<CurrentUserDto> {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new UnauthorizedException("Требуется вход в аккаунт")
    }
    const session = await this.findSession(hashSessionToken(token))
    if (
      !session ||
      session.expiresAt <= new Date() ||
      session.user.status !== "ACTIVE"
    ) {
      throw new UnauthorizedException("Сессия недействительна или истекла")
    }
    return toCurrentUser(session.user)
  }

  private async findSession(tokenHash: string) {
    try {
      return await this.prisma.session.findUnique({
        where: { tokenHash },
        select: {
          expiresAt: true,
          user: { select: { ...publicUserSelect, status: true } },
        },
      })
    } catch {
      throw new ServiceUnavailableException(
        "Сервис авторизации временно недоступен"
      )
    }
  }
}
