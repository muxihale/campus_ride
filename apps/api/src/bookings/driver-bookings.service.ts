import { textContains } from "../common/search.js"
import { paymentSelect, serializePayment } from "./payment.js"
import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common"
import { PrismaService } from "../prisma/prisma.service.js"
import type { Prisma } from "../generated/prisma/client.js"
import type {
  DriverBookingListDto,
  DriverBookingsQueryDto,
} from "./driver-bookings.dto.js"
const point = { id: true, name: true, address: true } as const
@Injectable()
export class DriverBookingsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async list(
    driverId: string,
    query: DriverBookingsQueryDto
  ): Promise<DriverBookingListDto> {
    const from = query.departureFrom ? new Date(query.departureFrom) : undefined
    const to = query.departureTo ? new Date(query.departureTo) : undefined
    if (from && to && from > to)
      throw new BadRequestException("Начало диапазона позже конца")
    const upcoming: Prisma.BookingWhereInput = {
      status: { in: ["PENDING", "CONFIRMED"] },
      ride: { status: "PUBLISHED", departureAt: { gt: new Date() } },
    }
    const text = query.q ? textContains(query.q) : undefined
    const where: Prisma.BookingWhereInput = {
      status: query.status,
      seats: { gte: query.minSeats },
      unitPriceKopecks: { lte: query.maxPriceKopecks },
      ride: {
        id: query.rideId,
        driverId,
        status: query.rideStatus,
        departureAt: { gte: from, lte: to },
      },
      AND: [
        ...(query.period === "upcoming"
          ? [upcoming]
          : query.period === "history"
            ? [{ NOT: upcoming }]
            : []),
        ...(text
          ? [
              {
                OR: [
                  { cancellationReason: text },
                  { passenger: { fullName: text } },
                  { passenger: { affiliation: text } },
                  {
                    ride: {
                      OR: [
                        { origin: { name: text } },
                        { origin: { address: text } },
                        { destination: { name: text } },
                        { destination: { address: text } },
                        { driver: { user: { fullName: text } } },
                        { vehicle: { make: text } },
                        { vehicle: { model: text } },
                      ],
                    },
                  },
                ],
              },
            ]
          : []),
      ],
    }
    const orderBy: Prisma.BookingOrderByWithRelationInput[] =
      query.sort === "createdDesc"
        ? [{ createdAt: "desc" }, { id: "asc" }]
        : [
            {
              ride: {
                departureAt: query.sort === "departureDesc" ? "desc" : "asc",
              },
            },
            { id: "asc" },
          ]
    try {
      const [rows, total] = await this.prisma.$transaction(
        [
          this.prisma.booking.findMany({
            where,
            orderBy,
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
            select: {
              payment: { select: paymentSelect },
              id: true,
              rideId: true,
              passengerId: true,
              passenger: {
                select: { id: true, fullName: true, affiliation: true },
              },
              seats: true,
              unitPriceKopecks: true,
              status: true,
              cancellationReason: true,
              createdAt: true,
              ride: {
                select: {
                  id: true,
                  seatsTotal: true,
                  bookings: {
                    where: { status: { in: ["PENDING", "CONFIRMED"] } },
                    select: { seats: true },
                  },
                  status: true,
                  departureAt: true,
                  origin: { select: point },
                  destination: { select: point },
                  driver: {
                    select: { user: { select: { id: true, fullName: true } } },
                  },
                  vehicle: { select: { make: true, model: true, color: true } },
                },
              },
            },
          }),
          this.prisma.booking.count({ where }),
        ],
        { isolationLevel: "RepeatableRead" }
      )
      return {
        items: rows.map(({ ride, ...row }) => {
          const { bookings, seatsTotal, driver, ...details } = ride
          return {
            ...row,
            payment: serializePayment(row.payment),
            ride: {
              ...details,
              driver: driver.user,
              availableSeats: Math.max(
                0,
                seatsTotal -
                  bookings.reduce((sum, booking) => sum + booking.seats, 0)
              ),
            },
          }
        }),
        total,
        page: query.page,
        pageSize: query.pageSize,
      }
    } catch {
      throw new ServiceUnavailableException("Заявки временно недоступны")
    }
  }
}
