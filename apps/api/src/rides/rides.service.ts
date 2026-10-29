import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common"
import { Prisma } from "../generated/prisma/client.js"
import { PrismaService } from "../prisma/prisma.service.js"
import type { CreateRideDto, RideDto } from "./ride.dto.js"

@Injectable()
export class RidesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(userId: string, input: CreateRideDto): Promise<RideDto> {
    const route = [
      input.originId,
      ...input.stops.map(({ locationId }) => locationId),
      input.destinationId,
    ]
    if (new Set(route).size !== route.length)
      throw new BadRequestException("Точки маршрута не должны повторяться")
    const departureAt = new Date(input.departureAt)
    if (!Number.isFinite(departureAt.getTime()))
      throw new BadRequestException("Неверное время отправления")
    try {
      return await this.prisma.$transaction(async (tx) => {
        const vehicle = await tx.vehicle.findFirst({
          where: { id: input.vehicleId, driverId: userId },
          select: { passengerSeats: true },
        })
        if (!vehicle) throw new NotFoundException("Автомобиль не найден")
        if (input.seatsTotal > vehicle.passengerSeats)
          throw new BadRequestException(
            "Число мест превышает вместимость автомобиля"
          )
        const count = await tx.location.count({ where: { id: { in: route } } })
        if (count !== route.length)
          throw new BadRequestException(
            "Одна или несколько точек маршрута не существуют"
          )
        if (departureAt.getTime() <= Date.now())
          throw new BadRequestException("Отправление должно быть в будущем")
        const ride = await tx.ride.create({
          data: {
            driverId: userId,
            vehicleId: input.vehicleId,
            originId: input.originId,
            destinationId: input.destinationId,
            departureAt,
            seatsTotal: input.seatsTotal,
            priceKopecks: input.priceKopecks,
            musicAllowed: input.musicAllowed,
            luggageAllowed: input.luggageAllowed,
            smokingAllowed: input.smokingAllowed,
            conditions: input.conditions,
            status: "DRAFT",
            stops: {
              create: input.stops.map(({ locationId }, index) => ({
                locationId,
                position: index + 1,
              })),
            },
          },
          select: {
            id: true,
            driverId: true,
            vehicleId: true,
            originId: true,
            destinationId: true,
            departureAt: true,
            seatsTotal: true,
            priceKopecks: true,
            musicAllowed: true,
            luggageAllowed: true,
            smokingAllowed: true,
            conditions: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            stops: {
              select: { id: true, locationId: true, position: true },
              orderBy: { position: "asc" },
            },
          },
        })
        return {
          ...ride,
          conditions: ride.conditions ?? "",
          departureAt: ride.departureAt.toISOString(),
          createdAt: ride.createdAt.toISOString(),
          updatedAt: ride.updatedAt.toISOString(),
        }
      })
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      )
        throw error
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2003"
      )
        throw new BadRequestException(
          "Автомобиль или точка маршрута больше недоступны"
        )
      throw new ServiceUnavailableException(
        "Не удалось создать черновик поездки. Повторите позже"
      )
    }
  }
}
