import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common"
import { PrismaService } from "../prisma/prisma.service.js"
import { Prisma } from "../generated/prisma/client.js"
import type {
  BookingDecisionDto,
  BookingDto,
  CreateBookingDto,
} from "./booking.dto.js"
const select = {
  id: true,
  rideId: true,
  passengerId: true,
  requestKey: true,
  seats: true,
  unitPriceKopecks: true,
  status: true,
  createdAt: true,
} as const
@Injectable()
export class BookingsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async create(
    passengerId: string,
    rideId: string,
    input: CreateBookingDto
  ): Promise<{ booking: BookingDto; created: boolean }> {
    // UUID в PostgreSQL не зависит от регистра; сравнения для повтора — тоже.
    rideId = rideId.toLowerCase()
    const requestKey = input.requestKey.toLowerCase()
    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<
          { id: string }[]
        >`SELECT "id" FROM "Ride" WHERE "id" = ${rideId}::uuid FOR UPDATE`
        if (!locked.length) throw new NotFoundException("Поездка недоступна")
        const previous = await tx.booking.findUnique({
          where: { requestKey },
          select,
        })
        if (previous) {
          if (
            previous.passengerId !== passengerId ||
            previous.rideId !== rideId ||
            previous.seats !== input.seats
          )
            throw new ConflictException(
              "Ключ запроса уже использован для другой заявки"
            )
          return { booking: previous, created: false }
        }
        const ride = await tx.ride.findUniqueOrThrow({
          where: { id: rideId },
          include: {
            driver: { include: { user: { include: { roles: true } } } },
          },
        })
        if (
          ride.status !== "PUBLISHED" ||
          ride.departureAt <= new Date() ||
          ride.driver.user.status !== "ACTIVE" ||
          !ride.driver.user.roles.some((role) => role.role === "DRIVER")
        )
          throw new NotFoundException("Поездка недоступна")
        if (ride.driverId === passengerId)
          throw new ForbiddenException("Нельзя бронировать собственную поездку")
        const active = await tx.booking.findFirst({
          where: {
            rideId,
            passengerId,
            status: { in: ["PENDING", "CONFIRMED"] },
          },
          select: { id: true },
        })
        if (active)
          throw new ConflictException(
            "У вас уже есть активная заявка на эту поездку"
          )
        const reserved = await tx.booking.aggregate({
          where: { rideId, status: { in: ["PENDING", "CONFIRMED"] } },
          _sum: { seats: true },
        })
        if (input.seats > ride.seatsTotal - (reserved._sum.seats ?? 0))
          throw new ConflictException("Недостаточно свободных мест")
        const booking = await tx.booking.create({
          data: {
            rideId,
            passengerId,
            requestKey,
            seats: input.seats,
            unitPriceKopecks: ride.priceKopecks,
            status: "PENDING",
            statusEvents: {
              create: { actorId: passengerId, toStatus: "PENDING" },
            },
          },
          select,
        })
        return { booking, created: true }
      })
    } catch (error) {
      if (error instanceof HttpException) throw error
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException("Заявка или ключ запроса уже существуют")
      throw new ServiceUnavailableException("Бронирование временно недоступно")
    }
  }
  async decide(
    driverId: string,
    id: string,
    status: "CONFIRMED" | "REJECTED",
    reason: string | null
  ): Promise<BookingDecisionDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Сначала блокируется поездка, как и при создании заявки.
        const locked = await tx.$queryRaw<
          { id: string }[]
        >`SELECT r."id" FROM "Ride" r JOIN "Booking" b ON b."rideId" = r."id" WHERE b."id" = ${id}::uuid AND r."driverId" = ${driverId}::uuid FOR UPDATE OF r`
        if (!locked.length) throw new NotFoundException("Заявка не найдена")
        const booking = await tx.booking.findUniqueOrThrow({
          where: { id },
          select: { ...select, cancellationReason: true },
        })
        if (booking.status === status) {
          if (status === "REJECTED" && booking.cancellationReason !== reason)
            throw new ConflictException(
              "Заявка уже отклонена с другой причиной"
            )
          return booking
        }
        if (booking.status !== "PENDING")
          throw new ConflictException(
            "Решение возможно только для ожидающей заявки"
          )
        const ride = await tx.ride.findUniqueOrThrow({
          where: { id: locked[0]!.id },
          select: { status: true, departureAt: true },
        })
        if (ride.status !== "PUBLISHED" || ride.departureAt <= new Date())
          throw new ConflictException(
            "Решение возможно только до отправления опубликованной поездки"
          )
        return tx.booking.update({
          where: { id },
          data: {
            status,
            cancellationReason: reason,
            statusEvents: {
              create: {
                actorId: driverId,
                fromStatus: "PENDING",
                toStatus: status,
                reason,
              },
            },
          },
          select: { ...select, cancellationReason: true },
        })
      })
    } catch (error) {
      if (error instanceof HttpException) throw error
      throw new ServiceUnavailableException(
        "Решение по заявке временно недоступно"
      )
    }
  }
}
