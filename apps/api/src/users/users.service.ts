import {
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common"
import { Prisma } from "../generated/prisma/client.js"
import { PrismaService } from "../prisma/prisma.service.js"
import type { BecomeDriverDto } from "./driver.dto.js"
import type { ProfileDto, UpdateProfileDto } from "./profile.dto.js"

const profileSelect = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  affiliation: true,
  roles: { select: { role: true } },
} satisfies Prisma.UserSelect

@Injectable()
export class UsersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async becomeDriver(
    userId: string,
    input: BecomeDriverDto
  ): Promise<ProfileDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.driverProfile.create({
          data: {
            userId,
            bio: input.bio || null,
            vehicles: { create: input.vehicle },
          },
        })
        await tx.userRole.upsert({
          where: { userId_role: { userId, role: "DRIVER" } },
          update: {},
          create: { userId, role: "DRIVER" },
        })
        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: profileSelect,
        })
        return { ...user, roles: user.roles.map(({ role }) => role) }
      })
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException(
          "Профиль водителя уже создан или госномер занят"
        )
      throw new ServiceUnavailableException(
        "Не удалось подключить роль водителя. Повторите позже"
      )
    }
  }

  async profile(userId: string, input?: UpdateProfileDto): Promise<ProfileDto> {
    try {
      const user =
        input === undefined
          ? await this.prisma.user.findUniqueOrThrow({
              where: { id: userId },
              select: profileSelect,
            })
          : await this.prisma.user.update({
              where: { id: userId },
              data: {
                fullName: input.fullName,
                phone: input.phone,
                affiliation: input.affiliation,
              },
              select: profileSelect,
            })
      return { ...user, roles: user.roles.map(({ role }) => role) }
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      )
        throw new UnauthorizedException("Требуется вход в аккаунт")
      throw new ServiceUnavailableException("Профиль временно недоступен")
    }
  }
}
