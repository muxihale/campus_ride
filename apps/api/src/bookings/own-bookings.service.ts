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
  OwnBookingListDto,
  OwnBookingsQueryDto,
} from "./own-bookings.dto.js"
const point = { id: true, name: true, address: true } as const
@Injectable()
export class OwnBookingsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async list(
    passengerId: string,
    query: OwnBookingsQueryDto
  ): Promise<OwnBookingListDto> {
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
      passengerId,
      status: query.status,
      seats: { gte: query.minSeats },
      unitPriceKopecks: { lte: query.maxPriceKopecks },
      ride: { status: query.rideStatus, departureAt: { gte: from, lte: to } },
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
              requestKey: true,
              seats: true,
              unitPriceKopecks: true,
              status: true,
              cancellationReason: true,
              createdAt: true,
              ride: {
                select: {
                  id: true,
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
        items: rows.map((row) => ({
          ...row,
          payment: serializePayment(row.payment),
          ride: {
            ...row.ride,
            driver: row.ride.driver.user,
          },
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      }
    } catch {
      throw new ServiceUnavailableException("Заявки временно недоступны")
    }
  }
}
