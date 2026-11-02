import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common"
import { PrismaService } from "../prisma/prisma.service.js"
import type { StartedRideDto } from "./ride-start.controller.js"
const select = { id: true, status: true, startedAt: true } as const
@Injectable()
export class RideStartService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async start(driverId: string, id: string): Promise<StartedRideDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<
          { id: string }[]
        >`SELECT "id" FROM "Ride" WHERE "id" = ${id}::uuid AND "driverId" = ${driverId}::uuid FOR UPDATE`
        if (!locked.length) throw new NotFoundException("Поездка не найдена")
        const ride = await tx.ride.findUniqueOrThrow({
          where: { id },
          select: { ...select, completedAt: true },
        })
        if (
          ride.status === "IN_PROGRESS" &&
          ride.startedAt &&
          !ride.completedAt
        )
          return {
            id: ride.id,
            status: "IN_PROGRESS",
            startedAt: ride.startedAt,
          }
        if (ride.status !== "PUBLISHED" || ride.startedAt || ride.completedAt)
          throw new ConflictException(
            "Начать можно только опубликованную поездку, которая ещё не началась"
          )
        // На 02.2 эта проверка заменяется обработкой заявок внутри этой транзакции.
        if (
          await tx.booking.count({ where: { rideId: id, status: "PENDING" } })
        )
          throw new ConflictException(
            "Сначала подтвердите или отклоните ожидающие заявки"
          )
        const updated = await tx.ride.update({
          where: { id },
          data: {
            status: "IN_PROGRESS",
            startedAt: new Date(),
            statusEvents: {
              create: {
                actorId: driverId,
                fromStatus: "PUBLISHED",
                toStatus: "IN_PROGRESS",
              },
            },
          },
          select,
        })
        return {
          id: updated.id,
          status: "IN_PROGRESS",
          startedAt: updated.startedAt!,
        }
      })
    } catch (error) {
      if (error instanceof HttpException) throw error
      throw new ServiceUnavailableException(
        "Начало поездки временно недоступно"
      )
    }
  }
}
