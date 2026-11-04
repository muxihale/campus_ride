import { lockActiveUser } from "../auth/active-user.js"
import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common"
import { PrismaService } from "../prisma/prisma.service.js"
import { cancelRide } from "./cancellation.js"
@Injectable()
export class RideCancellationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async cancel(driverId: string, id: string, reason: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockActiveUser(tx, driverId)
        const locked = await tx.$queryRaw<
          { id: string }[]
        >`SELECT "id" FROM "Ride" WHERE "id" = ${id}::uuid AND "driverId" = ${driverId}::uuid FOR UPDATE`
        if (!locked.length) throw new NotFoundException("Поездка не найдена")
        const ride = await tx.ride.findUniqueOrThrow({ where: { id } })
        if (ride.status === "CANCELLED") {
          if (ride.cancellationReason !== reason)
            throw new ConflictException(
              "Поездка уже отменена с другой причиной"
            )
          return {
            id: ride.id,
            status: ride.status,
            cancellationReason: ride.cancellationReason,
          }
        }
        if (!["DRAFT", "PUBLISHED"].includes(ride.status) || ride.startedAt)
          throw new ConflictException(
            "Нельзя отменить начатую или завершённую поездку"
          )
        await cancelRide(tx, ride, driverId, reason)
        return {
          id: ride.id,
          status: "CANCELLED" as const,
          cancellationReason: reason,
        }
      })
    } catch (error) {
      if (error instanceof HttpException) throw error
      throw new ServiceUnavailableException(
        "Отмена поездки временно недоступна"
      )
    }
  }
}
