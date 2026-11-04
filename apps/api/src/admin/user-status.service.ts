import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common"
import { lockActiveUser } from "../auth/active-user.js"
import { cancelReservation } from "../bookings/cancellation.js"
import { cancelRide } from "../rides/cancellation.js"
import { PrismaService } from "../prisma/prisma.service.js"
import type { UserStatusResultDto } from "./user-status.dto.js"
@Injectable()
export class UserStatusService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async change(
    actorId: string,
    id: string,
    blocked: boolean,
    reason: string
  ): Promise<UserStatusResultDto> {
    id = id.toLowerCase()
    if (actorId === id)
      throw new ConflictException(
        "Нельзя изменять блокировку собственного аккаунта"
      )
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Сериализация административных переходов предотвращает взаимную блокировку администраторов.
          await tx.$queryRaw`SELECT true FROM pg_advisory_xact_lock(20261104, 42)`
          await lockActiveUser(tx, actorId)
          if (
            !(await tx.userRole.findUnique({
              where: { userId_role: { userId: actorId, role: "ADMIN" } },
            }))
          )
            throw new ForbiddenException("Недостаточно прав")
          const users = await tx.$queryRaw<
            { status: "ACTIVE" | "BLOCKED" }[]
          >`SELECT "status" FROM "User" WHERE "id" = ${id}::uuid FOR NO KEY UPDATE`
          if (!users.length)
            throw new NotFoundException("Пользователь не найден")
          const status = blocked ? "BLOCKED" : "ACTIVE"
          const result: UserStatusResultDto = {
            id,
            status,
            changed: users[0]!.status !== status,
            cancelledRides: 0,
            cancelledBookings: 0,
            revokedSessions: 0,
          }
          if (!result.changed) return result
          if (blocked) {
            const now = new Date()
            // Аккаунт уже заблокирован для новых команд на уровне строки User.
            // Все затронутые поездки берутся в одном порядке до чтения заявок/платежей.
            const rides = await tx.$queryRaw<
              { id: string }[]
            >`SELECT r."id" FROM "Ride" r
            WHERE r."departureAt" > ${now} AND r."status" IN ('DRAFT', 'PUBLISHED') AND r."startedAt" IS NULL AND r."completedAt" IS NULL
            AND (r."driverId" = ${id}::uuid OR EXISTS (SELECT 1 FROM "Booking" b WHERE b."rideId" = r."id" AND b."passengerId" = ${id}::uuid AND b."status" IN ('PENDING', 'CONFIRMED')))
            ORDER BY r."id" FOR UPDATE OF r`
            const cancellationReason = `Блокировка аккаунта администратором: ${reason}`
            for (const row of rides) {
              const ride = await tx.ride.findUniqueOrThrow({
                where: { id: row.id },
              })
              // Статус мог измениться, пока ожидалась блокировка строки.
              if (
                !["DRAFT", "PUBLISHED"].includes(ride.status) ||
                ride.startedAt ||
                ride.completedAt ||
                ride.departureAt <= now
              )
                continue
              if (ride.driverId === id) {
                result.cancelledBookings += await cancelRide(
                  tx,
                  ride,
                  actorId,
                  cancellationReason,
                  true
                )
                result.cancelledRides++
              } else {
                const bookings = await tx.booking.findMany({
                  where: {
                    rideId: ride.id,
                    passengerId: id,
                    status: { in: ["PENDING", "CONFIRMED"] },
                  },
                  orderBy: { id: "asc" },
                  select: { id: true, status: true, passengerId: true },
                })
                for (const booking of bookings) {
                  await cancelReservation(
                    tx,
                    booking,
                    actorId,
                    cancellationReason,
                    ride.driverId,
                    false,
                    true
                  )
                  result.cancelledBookings++
                }
              }
            }
            result.revokedSessions = (
              await tx.session.deleteMany({ where: { userId: id } })
            ).count
          }
          await tx.user.update({ where: { id }, data: { status } })
          await tx.activityLog.create({
            data: {
              actorId,
              action: blocked ? "user.blocked" : "user.unblocked",
              resourceType: "user",
              resourceId: id,
              details: {
                fromStatus: users[0]!.status,
                toStatus: status,
                reason,
                cancelledRides: result.cancelledRides,
                cancelledBookings: result.cancelledBookings,
                revokedSessions: result.revokedSessions,
              },
            },
          })
          await tx.notification.create({
            data: {
              userId: id,
              kind: "SYSTEM",
              title: blocked
                ? "Ваш аккаунт заблокирован"
                : "Ваш аккаунт разблокирован",
              body: `Причина: ${reason}. ${blocked ? "Сессии завершены. Активные участия в будущих поездках отменены с демонстрационными возвратами." : "Для продолжения войдите заново. Отменённые поездки и заявки не восстанавливаются."}`,
              resourceType: "user",
              resourceId: id,
              link: "#/profile",
            },
          })
          await tx.notification.create({
            data: {
              userId: actorId,
              kind: "SYSTEM",
              title: blocked
                ? "Пользователь заблокирован"
                : "Пользователь разблокирован",
              body: `Причина: ${reason}. Отменено поездок: ${result.cancelledRides}, заявок: ${result.cancelledBookings}.`,
              resourceType: "user",
              resourceId: id,
              link: "#/admin",
            },
          })
          return result
        },
        { timeout: 15000 }
      )
    } catch (error) {
      if (error instanceof HttpException) throw error
      throw new ServiceUnavailableException(
        "Изменение блокировки временно недоступно"
      )
    }
  }
}
