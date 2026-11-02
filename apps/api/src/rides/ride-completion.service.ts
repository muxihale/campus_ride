import { recordRideLifecycle } from "./lifecycle-events.js"
import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common"
import { PrismaService } from "../prisma/prisma.service.js"
import type { CompletedRideDto } from "./ride-completion.controller.js"
@Injectable()
export class RideCompletionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async complete(driverId: string, id: string): Promise<CompletedRideDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<
          { id: string }[]
        >`SELECT "id" FROM "Ride" WHERE "id" = ${id}::uuid AND "driverId" = ${driverId}::uuid FOR UPDATE`
        if (!locked.length) throw new NotFoundException("Поездка не найдена")
        const ride = await tx.ride.findUniqueOrThrow({
          where: { id },
          select: {
            id: true,
            status: true,
            startedAt: true,
            completedAt: true,
          },
        })
        if (
          ride.status === "COMPLETED" &&
          ride.startedAt &&
          ride.completedAt &&
          ride.completedAt >= ride.startedAt
        )
          return {
            id: ride.id,
            status: "COMPLETED",
            startedAt: ride.startedAt,
            completedAt: ride.completedAt,
          }
        const completedAt = new Date()
        if (
          ride.status !== "IN_PROGRESS" ||
          !ride.startedAt ||
          ride.completedAt ||
          completedAt < ride.startedAt
        )
          throw new ConflictException(
            "Завершить можно только начатую поездку с корректным временем начала"
          )
        if (
          await tx.booking.count({ where: { rideId: id, status: "PENDING" } })
        )
          throw new ConflictException(
            "У начатой поездки не должно быть ожидающих заявок"
          )
        const bookings = await tx.booking.findMany({
          where: { rideId: id, status: "CONFIRMED" },
          orderBy: { id: "asc" },
          select: {
            id: true,
            passengerId: true,
            seats: true,
            unitPriceKopecks: true,
            payment: {
              select: { status: true, isDemo: true, amountKopecks: true },
            },
          },
        })
        for (const booking of bookings) {
          if (
            !booking.payment ||
            !booking.payment.isDemo ||
            booking.payment.status !== "SUCCEEDED" ||
            booking.payment.amountKopecks !==
              BigInt(booking.seats) * BigInt(booking.unitPriceKopecks)
          )
            throw new ConflictException(
              "У подтверждённой заявки должен быть корректный успешный демо-платёж"
            )
          await tx.booking.update({
            where: { id: booking.id },
            data: {
              status: "COMPLETED",
              statusEvents: {
                create: {
                  actorId: driverId,
                  fromStatus: "CONFIRMED",
                  toStatus: "COMPLETED",
                },
              },
            },
          })
          await tx.activityLog.create({
            data: {
              actorId: driverId,
              action: "booking.completed",
              resourceType: "booking",
              resourceId: booking.id,
              details: {
                fromStatus: "CONFIRMED",
                toStatus: "COMPLETED",
                rideId: id,
              },
            },
          })
        }
        await tx.ride.update({
          where: { id },
          data: {
            status: "COMPLETED",
            completedAt,
            statusEvents: {
              create: {
                actorId: driverId,
                fromStatus: "IN_PROGRESS",
                toStatus: "COMPLETED",
              },
            },
          },
        })
        await recordRideLifecycle(
          tx,
          driverId,
          id,
          true,
          bookings.map((booking) => booking.passengerId),
          completedAt
        )
        return {
          id: ride.id,
          status: "COMPLETED",
          startedAt: ride.startedAt,
          completedAt,
        }
      })
    } catch (error) {
      if (error instanceof HttpException) throw error
      throw new ServiceUnavailableException(
        "Завершение поездки временно недоступно"
      )
    }
  }
}
