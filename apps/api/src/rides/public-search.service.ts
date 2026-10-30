import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common"
import { Prisma } from "../generated/prisma/client.js"
import { PrismaService } from "../prisma/prisma.service.js"
import type {
  PublicRideDto,
  PublicRideListDto,
  PublicSearchDto,
} from "./public-search.dto.js"

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
    const conditions: Prisma.Sql[] = [
      Prisma.sql`r."status" = 'PUBLISHED'`,
      Prisma.sql`r."departureAt" > ${new Date()}`,
      Prisma.sql`u."status" = 'ACTIVE'`,
      Prisma.sql`EXISTS (SELECT 1 FROM "UserRole" ur WHERE ur."userId" = u."id" AND ur."role" = 'DRIVER')`,
    ]
    if (start) conditions.push(Prisma.sql`r."departureAt" >= ${start}`)
    if (end) conditions.push(Prisma.sql`r."departureAt" < ${end}`)
    if (query.originDistrictId)
      conditions.push(
        Prisma.sql`o."districtId" = ${query.originDistrictId}::uuid`
      )
    if (query.direction === "TO_CAMPUS")
      conditions.push(
        query.campusId
          ? Prisma.sql`d."campusId" = ${query.campusId}::uuid`
          : Prisma.sql`d."campusId" IS NOT NULL`
      )
    else if (query.direction === "FROM_CAMPUS")
      conditions.push(
        query.campusId
          ? Prisma.sql`o."campusId" = ${query.campusId}::uuid`
          : Prisma.sql`o."campusId" IS NOT NULL`
      )
    else if (query.campusId)
      conditions.push(
        Prisma.sql`(o."campusId" = ${query.campusId}::uuid OR d."campusId" = ${query.campusId}::uuid)`
      )
    if (query.maxPriceKopecks !== undefined)
      conditions.push(Prisma.sql`r."priceKopecks" <= ${query.maxPriceKopecks}`)
    if (query.musicAllowed !== undefined)
      conditions.push(Prisma.sql`r."musicAllowed" = ${query.musicAllowed}`)
    if (query.luggageAllowed !== undefined)
      conditions.push(Prisma.sql`r."luggageAllowed" = ${query.luggageAllowed}`)
    if (query.smokingAllowed !== undefined)
      conditions.push(Prisma.sql`r."smokingAllowed" = ${query.smokingAllowed}`)
    if (query.q) {
      const text = `%${query.q}%`
      conditions.push(
        Prisma.sql`(r."conditions" ILIKE ${text} OR o."name" ILIKE ${text} OR o."address" ILIKE ${text} OR od."name" ILIKE ${text} OR oc."name" ILIKE ${text} OR d."name" ILIKE ${text} OR d."address" ILIKE ${text} OR dd."name" ILIKE ${text} OR dc."name" ILIKE ${text})`
      )
    }
    // Остаток и фильтр считаются в БД до LIMIT/OFFSET, без загрузки всех заявок в приложение.
    const available = Prisma.sql`WITH candidates AS (
      SELECT r."id", r."departureAt", r."seatsTotal", r."priceKopecks", r."musicAllowed", r."luggageAllowed", r."smokingAllowed", r."conditions",
        jsonb_build_object('id', o."id", 'name', o."name", 'address', o."address") AS "origin",
        jsonb_build_object('id', d."id", 'name', d."name", 'address', d."address") AS "destination",
        jsonb_build_object('id', u."id", 'fullName', u."fullName") AS "driver",
        jsonb_build_object('make', v."make", 'model', v."model", 'color', v."color") AS "vehicle",
        GREATEST(0::bigint, r."seatsTotal"::bigint - COALESCE(occupied."seats", 0))::integer AS "availableSeats"
      FROM "Ride" r
      JOIN "DriverProfile" dp ON dp."userId" = r."driverId"
      JOIN "User" u ON u."id" = dp."userId"
      JOIN "Vehicle" v ON v."id" = r."vehicleId"
      JOIN "Location" o ON o."id" = r."originId"
      JOIN "Location" d ON d."id" = r."destinationId"
      JOIN "District" od ON od."id" = o."districtId"
      JOIN "District" dd ON dd."id" = d."districtId"
      LEFT JOIN "Campus" oc ON oc."id" = o."campusId"
      LEFT JOIN "Campus" dc ON dc."id" = d."campusId"
      LEFT JOIN LATERAL (
        SELECT SUM(b."seats") AS "seats" FROM "Booking" b
        WHERE b."rideId" = r."id" AND b."status" IN ('PENDING', 'CONFIRMED')
      ) occupied ON true
      WHERE ${Prisma.join(conditions, " AND ")}
    ), available AS (
      SELECT * FROM candidates WHERE "availableSeats" >= ${query.minSeats ?? 1}
    )`
    const orderBy =
      query.sort === "priceAsc"
        ? Prisma.sql`"priceKopecks" ASC, "departureAt" ASC, "id" ASC`
        : query.sort === "priceDesc"
          ? Prisma.sql`"priceKopecks" DESC, "departureAt" ASC, "id" ASC`
          : query.sort === "departureDesc"
            ? Prisma.sql`"departureAt" DESC, "id" ASC`
            : Prisma.sql`"departureAt" ASC, "id" ASC`
    try {
      const [items, counts] = await this.prisma.$transaction(
        [
          this.prisma.$queryRaw<PublicRideDto[]>(
            Prisma.sql`${available} SELECT * FROM available ORDER BY ${orderBy} LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`
          ),
          this.prisma.$queryRaw<{ total: number }[]>(
            Prisma.sql`${available} SELECT COUNT(*)::integer AS "total" FROM available`
          ),
        ],
        { isolationLevel: "RepeatableRead" }
      )
      return {
        items,
        total: counts[0]!.total,
        page: query.page,
        pageSize: query.pageSize,
      }
    } catch {
      throw new ServiceUnavailableException("Поиск поездок временно недоступен")
    }
  }
}
