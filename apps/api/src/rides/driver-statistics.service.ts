import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common"
import { Prisma } from "../generated/prisma/client.js"
import { PrismaService } from "../prisma/prisma.service.js"
import type {
  DriverStatisticsDto,
  DriverStatisticsQueryDto,
} from "./driver-statistics.dto.js"
type Totals = Omit<
  DriverStatisticsDto,
  "dateFrom" | "dateTo" | "periodBasis" | "isDemo" | "currency"
>
@Injectable()
export class DriverStatisticsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async get(
    driverId: string,
    query: DriverStatisticsQueryDto
  ): Promise<DriverStatisticsDto> {
    const from = query.dateFrom ? new Date(query.dateFrom) : undefined,
      to = query.dateTo ? new Date(query.dateTo) : undefined
    if (from && to && from > to)
      throw new BadRequestException("Начало периода позже конца")
    const filters = [Prisma.sql`"driverId" = ${driverId}::uuid`]
    if (from) filters.push(Prisma.sql`"departureAt" >= ${from}`)
    if (to) filters.push(Prisma.sql`"departureAt" <= ${to}`)
    try {
      // Одна SQL-команда: все показатели читаются в одном снимке без размножения поездок JOIN-ами.
      const rows = await this.prisma.$queryRaw<Totals[]>(Prisma.sql`
        WITH selected_rides AS (SELECT "id", "status" FROM "Ride" WHERE ${Prisma.join(filters, " AND ")}),
        selected_bookings AS (SELECT b.*, r."status" AS "rideStatus" FROM "Booking" b JOIN selected_rides r ON r."id"=b."rideId"),
        transported AS (SELECT * FROM selected_bookings WHERE "status"='COMPLETED' AND "rideStatus"='COMPLETED'),
        valid_payments AS (SELECT p.*, b."status" AS "bookingStatus", b."rideStatus" FROM "Payment" p JOIN selected_bookings b ON b."id"=p."bookingId" WHERE p."isDemo"=true AND p."amountKopecks"=b."seats"::bigint*b."unitPriceKopecks"::bigint),
        retained AS (SELECT * FROM valid_payments WHERE "status"='SUCCEEDED' AND (("bookingStatus"='CONFIRMED' AND "rideStatus" IN ('PUBLISHED','IN_PROGRESS')) OR ("bookingStatus"='COMPLETED' AND "rideStatus"='COMPLETED')))
        SELECT
          (SELECT COUNT(*)::integer FROM selected_rides) AS "ridesTotal",
          (SELECT COUNT(*)::integer FROM selected_rides WHERE "status"='DRAFT') AS "draftRides",
          (SELECT COUNT(*)::integer FROM selected_rides WHERE "status"='PUBLISHED') AS "publishedRides",
          (SELECT COUNT(*)::integer FROM selected_rides WHERE "status"='IN_PROGRESS') AS "inProgressRides",
          (SELECT COUNT(*)::integer FROM selected_rides WHERE "status"='COMPLETED') AS "completedRides",
          (SELECT COUNT(*)::integer FROM selected_rides WHERE "status"='CANCELLED') AS "cancelledRides",
          (SELECT COUNT(*)::integer FROM transported) AS "completedBookings",
          (SELECT COUNT(DISTINCT "passengerId")::integer FROM transported) AS "passengersTransported",
          (SELECT COALESCE(SUM("seats"),0)::integer FROM transported) AS "seatsTransported",
          (SELECT COUNT(*)::integer FROM selected_bookings WHERE "status"='CANCELLED') AS "cancelledBookings",
          (SELECT COUNT(*)::integer FROM selected_bookings WHERE "status"='REJECTED') AS "rejectedBookings",
          (SELECT COALESCE(SUM("amountKopecks"),0)::text FROM retained) AS "demoReceiptsKopecks",
          (SELECT COALESCE(SUM("amountKopecks"),0)::text FROM retained WHERE "bookingStatus"='COMPLETED' AND "rideStatus"='COMPLETED') AS "demoCompletedRevenueKopecks",
          (SELECT COALESCE(SUM("amountKopecks"),0)::text FROM valid_payments WHERE "status"='REFUNDED' AND "bookingStatus"='CANCELLED') AS "demoRefundsKopecks"
      `)
      return {
        ...rows[0]!,
        dateFrom: from?.toISOString() ?? null,
        dateTo: to?.toISOString() ?? null,
        periodBasis: "departureAt",
        isDemo: true,
        currency: "RUB",
      }
    } catch {
      throw new ServiceUnavailableException(
        "Статистика водителя временно недоступна"
      )
    }
  }
}
