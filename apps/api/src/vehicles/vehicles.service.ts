import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common"
import { Prisma } from "../generated/prisma/client.js"
import { PrismaService } from "../prisma/prisma.service.js"
import {
  normalizeRegistrationNumber,
  type CreateVehicleDto,
} from "../users/driver.dto.js"
import type {
  UpdateVehicleDto,
  VehicleDto,
  VehicleListDto,
  VehicleQueryDto,
} from "./vehicle.dto.js"

const vehicleSelect = {
  id: true,
  make: true,
  model: true,
  color: true,
  registrationNumber: true,
  passengerSeats: true,
  createdAt: true,
} satisfies Prisma.VehicleSelect

@Injectable()
export class VehiclesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(userId: string, query: VehicleQueryDto): Promise<VehicleListDto> {
    if (
      query.minSeats !== undefined &&
      query.maxSeats !== undefined &&
      query.minSeats > query.maxSeats
    )
      throw new BadRequestException("Минимум мест не может превышать максимум")
    const where: Prisma.VehicleWhereInput = {
      driverId: userId,
      ...(query.make
        ? { make: { contains: query.make, mode: "insensitive" } }
        : {}),
      ...(query.model
        ? { model: { contains: query.model, mode: "insensitive" } }
        : {}),
      ...(query.color
        ? { color: { contains: query.color, mode: "insensitive" } }
        : {}),
      passengerSeats: { gte: query.minSeats, lte: query.maxSeats },
      ...(query.q
        ? {
            OR: ["make", "model", "color", "registrationNumber"].map(
              (field) => ({
                [field]: {
                  contains:
                    field === "registrationNumber"
                      ? normalizeRegistrationNumber(query.q!)
                      : query.q,
                  mode: "insensitive",
                },
              })
            ),
          }
        : {}),
    }
    try {
      const [items, total] = await this.prisma.$transaction(
        [
          this.prisma.vehicle.findMany({
            where,
            select: vehicleSelect,
            orderBy: [{ createdAt: "desc" }, { id: "asc" }],
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
          }),
          this.prisma.vehicle.count({ where }),
        ],
        { isolationLevel: "RepeatableRead" }
      )
      return { items, total, page: query.page, pageSize: query.pageSize }
    } catch (error) {
      return this.fail(error)
    }
  }

  async create(userId: string, input: CreateVehicleDto): Promise<VehicleDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Поддерживает подготовленные демо-аккаунты DRIVER без профиля; роль уже проверена guard.
        await tx.driverProfile.createMany({
          data: [{ userId }],
          skipDuplicates: true,
        })
        return tx.vehicle.create({
          data: {
            driverId: userId,
            make: input.make,
            model: input.model,
            color: input.color,
            registrationNumber: input.registrationNumber,
            passengerSeats: input.passengerSeats,
          },
          select: vehicleSelect,
        })
      })
    } catch (error) {
      return this.fail(error)
    }
  }

  async update(
    userId: string,
    id: string,
    input: UpdateVehicleDto
  ): Promise<VehicleDto> {
    try {
      return await this.prisma.vehicle.update({
        where: { id, driverId: userId },
        data: this.fields(input),
        select: vehicleSelect,
      })
    } catch (error) {
      return this.fail(error)
    }
  }

  private fields(input: UpdateVehicleDto) {
    return {
      make: input.make,
      model: input.model,
      color: input.color,
      registrationNumber: input.registrationNumber,
      passengerSeats: input.passengerSeats,
    }
  }

  private fail(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002")
        throw new ConflictException(
          "Автомобиль с таким госномером уже существует"
        )
      if (error.code === "P2025")
        throw new NotFoundException("Автомобиль не найден")
    }
    throw new ServiceUnavailableException("Автомобили временно недоступны")
  }
}
