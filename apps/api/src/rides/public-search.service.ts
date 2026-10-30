import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common"
import type { Prisma } from "../generated/prisma/client.js"
import { PrismaService } from "../prisma/prisma.service.js"
import type { PublicRideListDto, PublicSearchDto } from "./public-search.dto.js"
const pointSelect = { id: true, name: true, address: true }
@Injectable()
export class PublicSearchService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async search(query: PublicSearchDto): Promise<PublicRideListDto> {
    if ((query.timeFrom || query.timeTo) && !query.date)
      throw new BadRequestException("Для фильтра времени укажите дату")
    if (query.timeFrom && query.timeTo && query.timeFrom > query.timeTo)
      throw new BadRequestException("Начало времени не может быть позже конца")
    let start: Date | undefined, end: Date | undefined
    if (query.date) {
      start = new Date(`${query.date}T${query.timeFrom ?? "00:00"}:00+05:00`)
      end = query.timeTo
        ? new Date(
            new Date(`${query.date}T${query.timeTo}:00+05:00`).getTime() + 60000
          )
        : new Date(
            new Date(`${query.date}T00:00:00+05:00`).getTime() + 86400000
          )
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()))
        throw new BadRequestException("Неверная дата поиска")
    }
    const and: Prisma.RideWhereInput[] = []
    if (query.direction === "TO_CAMPUS")
      and.push({ destination: { campusId: query.campusId ?? { not: null } } })
    else if (query.direction === "FROM_CAMPUS")
      and.push({ origin: { campusId: query.campusId ?? { not: null } } })
    else if (query.campusId)
      and.push({
        OR: [
          { origin: { campusId: query.campusId } },
          { destination: { campusId: query.campusId } },
        ],
      })
    if (query.q) {
      const text = { contains: query.q, mode: "insensitive" as const }
      and.push({
        OR: [
          { conditions: text },
          { origin: { name: text } },
          { origin: { address: text } },
          { origin: { district: { name: text } } },
          { origin: { campus: { name: text } } },
          { destination: { name: text } },
          { destination: { address: text } },
          { destination: { district: { name: text } } },
          { destination: { campus: { name: text } } },
        ],
      })
    }
    const where: Prisma.RideWhereInput = {
      status: "PUBLISHED",
      departureAt: { gt: new Date(), gte: start, lt: end },
      driver: {
        user: { status: "ACTIVE", roles: { some: { role: "DRIVER" } } },
      },
      origin: { districtId: query.originDistrictId },
      priceKopecks: { lte: query.maxPriceKopecks },
      seatsTotal: { gte: query.minSeats },
      musicAllowed: query.musicAllowed,
      luggageAllowed: query.luggageAllowed,
      smokingAllowed: query.smokingAllowed,
      AND: and,
    }
    const orderBy: Prisma.RideOrderByWithRelationInput[] =
      query.sort.startsWith("price")
        ? [
            { priceKopecks: query.sort === "priceAsc" ? "asc" : "desc" },
            { departureAt: "asc" },
            { id: "asc" },
          ]
        : [
            { departureAt: query.sort === "departureDesc" ? "desc" : "asc" },
            { id: "asc" },
          ]
    try {
      const [rows, total] = await this.prisma.$transaction(
        [
          this.prisma.ride.findMany({
            where,
            select: {
              id: true,
              origin: { select: pointSelect },
              destination: { select: pointSelect },
              departureAt: true,
              seatsTotal: true,
              priceKopecks: true,
              musicAllowed: true,
              luggageAllowed: true,
              smokingAllowed: true,
              conditions: true,
              vehicle: { select: { make: true, model: true, color: true } },
              driver: {
                select: { user: { select: { id: true, fullName: true } } },
              },
            },
            orderBy,
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
          }),
          this.prisma.ride.count({ where }),
        ],
        { isolationLevel: "RepeatableRead" }
      )
      return {
        items: rows.map(({ driver, ...ride }) => ({
          ...ride,
          driver: driver.user,
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      }
    } catch {
      throw new ServiceUnavailableException("Поиск поездок временно недоступен")
    }
  }
}
