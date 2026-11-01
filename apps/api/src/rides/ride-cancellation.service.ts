import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common"
import { PrismaService } from "../prisma/prisma.service.js"
import { cancelReservation } from "../bookings/cancellation.js"
@Injectable()
export class RideCancellationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async cancel(driverId: string, id: string, reason: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
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
        const bookings = await tx.booking.findMany({
          where: { rideId: id, status: { in: ["PENDING", "CONFIRMED"] } },
          orderBy: { id: "asc" },
          select: { id: true, status: true, passengerId: true },
        })
        for (const booking of bookings)
          await cancelReservation(tx, booking, driverId, reason, driverId, true)
        await tx.ride.update({
          where: { id },
          data: {
            status: "CANCELLED",
            cancellationReason: reason,
            statusEvents: {
              create: {
                actorId: driverId,
                fromStatus: ride.status,
                toStatus: "CANCELLED",
                reason,
              },
            },
          },
        })
        await tx.activityLog.create({
          data: {
            actorId: driverId,
            action: "ride.cancelled",
            resourceType: "ride",
            resourceId: id,
            details: {
              fromStatus: ride.status,
              toStatus: "CANCELLED",
              reason,
              cancelledBookings: bookings.length,
            },
          },
        })
        await tx.notification.create({
          data: {
            userId: driverId,
            kind: "RIDE_CANCELLED",
            title: "Поездка отменена",
            body: `Причина: ${reason}. Активные заявки отменены; успешные демонстрационные платежи полностью возвращены.`,
            link: "#/rides",
            resourceType: "ride",
            resourceId: id,
          },
        })
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
