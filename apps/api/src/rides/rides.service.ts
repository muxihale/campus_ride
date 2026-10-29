import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common"
import { plainToInstance } from "class-transformer"
import { validate as validateDto } from "class-validator"
import { Prisma } from "../generated/prisma/client.js"
import { PrismaService } from "../prisma/prisma.service.js"
import { CreateRideDto, type RideDto, type UpdateRideDto } from "./ride.dto.js"
import type { RideListDto, RideQueryDto } from "./ride-query.dto.js"

const rideSelect = {
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
} satisfies Prisma.RideSelect
type StoredRide = Prisma.RideGetPayload<{ select: typeof rideSelect }>
function serialize(ride: StoredRide): RideDto {
  return {
    ...ride,
    conditions: ride.conditions ?? "",
    departureAt: ride.departureAt.toISOString(),
    createdAt: ride.createdAt.toISOString(),
    updatedAt: ride.updatedAt.toISOString(),
  }
}

@Injectable()
export class RidesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(userId: string, input: CreateRideDto): Promise<RideDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const data = await this.validate(tx, userId, input)
        return serialize(
          await tx.ride.create({
            data: {
              ...data,
              driverId: userId,
              status: "DRAFT",
              stops: { create: this.stops(input.stops) },
            },
            select: rideSelect,
          })
        )
      })
    } catch (error) {
      return this.fail(
        error,
        "Не удалось создать черновик поездки. Повторите позже"
      )
    }
  }

  async list(userId: string, query: RideQueryDto): Promise<RideListDto> {
    const from = query.departureFrom ? new Date(query.departureFrom) : undefined
    const to = query.departureTo ? new Date(query.departureTo) : undefined
    if (
      (from && !Number.isFinite(from.getTime())) ||
      (to && !Number.isFinite(to.getTime())) ||
      (from && to && from > to)
    )
      throw new BadRequestException("Неверный диапазон времени отправления")
    const text = query.q
      ? { contains: query.q, mode: "insensitive" as const }
      : undefined
    const where: Prisma.RideWhereInput = {
      driverId: userId,
      status: query.status,
      vehicleId: query.vehicleId,
      originId: query.originId,
      destinationId: query.destinationId,
      priceKopecks: { lte: query.maxPriceKopecks },
      seatsTotal: { gte: query.minSeats },
      departureAt: { gte: from, lte: to },
      ...(text
        ? {
            OR: [
              { conditions: text },
              { origin: { name: text } },
              { origin: { address: text } },
              { destination: { name: text } },
              { destination: { address: text } },
              { vehicle: { make: text } },
              { vehicle: { model: text } },
            ],
          }
        : {}),
    }
    const orderBy: Prisma.RideOrderByWithRelationInput[] =
      query.sort === "createdDesc"
        ? [{ createdAt: "desc" }, { id: "asc" }]
        : [
            { departureAt: query.sort === "departureDesc" ? "desc" : "asc" },
            { id: "asc" },
          ]
    try {
      const [items, total] = await this.prisma.$transaction(
        [
          this.prisma.ride.findMany({
            where,
            select: rideSelect,
            orderBy,
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
          }),
          this.prisma.ride.count({ where }),
        ],
        { isolationLevel: "RepeatableRead" }
      )
      return {
        items: items.map(serialize),
        total,
        page: query.page,
        pageSize: query.pageSize,
      }
    } catch (error) {
      return this.fail(error)
    }
  }

  async detail(userId: string, id: string): Promise<RideDto> {
    try {
      const ride = await this.prisma.ride.findFirst({
        where: { id, driverId: userId },
        select: rideSelect,
      })
      if (!ride) throw new NotFoundException("Поездка не найдена")
      return serialize(ride)
    } catch (error) {
      return this.fail(error)
    }
  }

  async update(
    userId: string,
    id: string,
    input: UpdateRideDto
  ): Promise<RideDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const ride = await this.editable(tx, userId, id)
        const current = serialize(ride)
        const merged: CreateRideDto = {
          vehicleId: input.vehicleId ?? current.vehicleId,
          originId: input.originId ?? current.originId,
          destinationId: input.destinationId ?? current.destinationId,
          departureAt: input.departureAt ?? current.departureAt,
          seatsTotal: input.seatsTotal ?? current.seatsTotal,
          priceKopecks: input.priceKopecks ?? current.priceKopecks,
          conditions: input.conditions ?? current.conditions,
          musicAllowed: input.musicAllowed ?? current.musicAllowed,
          luggageAllowed: input.luggageAllowed ?? current.luggageAllowed,
          smokingAllowed: input.smokingAllowed ?? current.smokingAllowed,
          stops: input.stops ?? current.stops,
        }
        const data = await this.validate(tx, userId, merged)
        return serialize(
          await tx.ride.update({
            where: { id },
            data: {
              ...data,
              ...(input.stops !== undefined
                ? { stops: { deleteMany: {}, create: this.stops(input.stops) } }
                : {}),
            },
            select: rideSelect,
          })
        )
      })
    } catch (error) {
      return this.fail(error)
    }
  }

  async publish(userId: string, id: string): Promise<RideDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const ride = await this.ownedForUpdate(tx, userId, id)
        // Повтор команды возвращает текущее состояние, не повторяя побочные действия.
        if (ride.status === "PUBLISHED") return serialize(ride)
        if (ride.status !== "DRAFT")
          throw new ConflictException("Опубликовать можно только черновик")
        if (await tx.booking.count({ where: { rideId: id } }))
          throw new ConflictException("У черновика есть бронирования")
        const input = plainToInstance(CreateRideDto, {
          vehicleId: ride.vehicleId,
          originId: ride.originId,
          destinationId: ride.destinationId,
          departureAt: ride.departureAt.toISOString(),
          seatsTotal: ride.seatsTotal,
          priceKopecks: ride.priceKopecks,
          musicAllowed: ride.musicAllowed,
          luggageAllowed: ride.luggageAllowed,
          smokingAllowed: ride.smokingAllowed,
          conditions: ride.conditions,
          stops: ride.stops.map(({ locationId }) => ({ locationId })),
        })
        if (
          (
            await validateDto(input, {
              whitelist: true,
              forbidNonWhitelisted: true,
            })
          ).length
        )
          throw new BadRequestException(
            "Заполните все поля черновика перед публикацией"
          )
        // Вместимость читается после блокировки автомобиля; параллельное изменение ждёт завершения публикации.
        const vehicle = await tx.$queryRaw<
          { id: string }[]
        >`SELECT "id" FROM "Vehicle" WHERE "id" = ${ride.vehicleId}::uuid AND "driverId" = ${userId}::uuid FOR SHARE`
        if (!vehicle.length) throw new NotFoundException("Автомобиль не найден")
        await this.validate(tx, userId, input)
        const published = await tx.ride.update({
          where: { id },
          data: { status: "PUBLISHED" },
          select: rideSelect,
        })
        await tx.rideStatusEvent.create({
          data: {
            rideId: id,
            actorId: userId,
            fromStatus: "DRAFT",
            toStatus: "PUBLISHED",
          },
        })
        await tx.notification.create({
          data: {
            userId,
            kind: "SYSTEM",
            title: "Поездка опубликована",
            body: "Поездка опубликована. Посмотреть её можно в кабинете водителя.",
            link: "#/driver",
            resourceType: "ride",
            resourceId: id,
          },
        })
        return serialize(published)
      })
    } catch (error) {
      return this.fail(
        error,
        "Не удалось опубликовать поездку. Повторите позже"
      )
    }
  }

  async remove(userId: string, id: string): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.editable(tx, userId, id)
        await tx.ride.delete({ where: { id } })
      })
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2003"
      )
        throw new ConflictException("У поездки есть связанные данные")
      this.fail(error)
    }
  }

  private async editable(
    tx: Prisma.TransactionClient,
    userId: string,
    id: string
  ): Promise<StoredRide> {
    const ride = await this.ownedForUpdate(tx, userId, id)
    if (ride.status !== "DRAFT")
      throw new ConflictException("Изменять и удалять можно только черновик")
    if (await tx.booking.count({ where: { rideId: id } }))
      throw new ConflictException("У черновика есть бронирования")
    return ride
  }

  private async ownedForUpdate(
    tx: Prisma.TransactionClient,
    userId: string,
    id: string
  ): Promise<StoredRide> {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT "id" FROM "Ride" WHERE "id" = ${id}::uuid AND "driverId" = ${userId}::uuid FOR UPDATE`
    if (!rows.length) throw new NotFoundException("Поездка не найдена")
    return tx.ride.findUniqueOrThrow({
      where: { id },
      select: rideSelect,
    })
  }

  private stops(input: CreateRideDto["stops"]) {
    return input.map(({ locationId }, index) => ({
      locationId,
      position: index + 1,
    }))
  }

  private async validate(
    tx: Prisma.TransactionClient,
    userId: string,
    input: CreateRideDto
  ) {
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
    const vehicle = await tx.vehicle.findFirst({
      where: { id: input.vehicleId, driverId: userId },
      select: { passengerSeats: true },
    })
    if (!vehicle) throw new NotFoundException("Автомобиль не найден")
    if (input.seatsTotal > vehicle.passengerSeats)
      throw new BadRequestException(
        "Число мест превышает вместимость автомобиля"
      )
    if (
      (await tx.location.count({ where: { id: { in: route } } })) !==
      route.length
    )
      throw new BadRequestException(
        "Одна или несколько точек маршрута не существуют"
      )
    if (departureAt.getTime() <= Date.now())
      throw new BadRequestException("Отправление должно быть в будущем")
    return {
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
    }
  }

  private fail(error: unknown, message = "Поездки временно недоступны"): never {
    if (
      error instanceof BadRequestException ||
      error instanceof NotFoundException ||
      error instanceof ConflictException
    )
      throw error
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2003")
        throw new BadRequestException(
          "Автомобиль или точка маршрута больше недоступны"
        )
      if (error.code === "P2025")
        throw new NotFoundException("Поездка не найдена")
    }
    throw new ServiceUnavailableException(message)
  }
}
