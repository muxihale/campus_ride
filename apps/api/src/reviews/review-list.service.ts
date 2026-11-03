import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common"
import { Prisma } from "../generated/prisma/client.js"
import { PrismaService } from "../prisma/prisma.service.js"
import type {
  OwnReviewsListDto,
  OwnReviewsQueryDto,
  PublicReviewsListDto,
  ReviewsQueryDto,
  UserRatingsDto,
} from "./review-query.dto.js"

// Роль оценки определяется историческим участием, а не текущими ролями аккаунта.
const valid = Prisma.sql`FROM "Review" rv JOIN "Booking" b ON b."id" = rv."bookingId" JOIN "Ride" r ON r."id" = b."rideId"
 JOIN "User" a ON a."id" = rv."authorId" JOIN "User" u ON u."id" = rv."recipientId"
 WHERE rv."hiddenAt" IS NULL AND b."status" = 'COMPLETED' AND r."status" = 'COMPLETED'
 AND b."passengerId" <> r."driverId" AND ((rv."authorId" = b."passengerId" AND rv."recipientId" = r."driverId") OR (rv."authorId" = r."driverId" AND rv."recipientId" = b."passengerId"))`
const role = Prisma.sql`CASE WHEN rv."recipientId" = r."driverId" THEN 'DRIVER' ELSE 'PASSENGER' END`
@Injectable()
export class ReviewListService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async list(
    userId: string,
    query: ReviewsQueryDto,
    own = false
  ): Promise<OwnReviewsListDto | PublicReviewsListDto> {
    const from = query.dateFrom ? new Date(query.dateFrom) : undefined
    const to = query.dateTo ? new Date(query.dateTo) : undefined
    if (
      (from && to && from > to) ||
      (query.ratingMin !== undefined &&
        query.ratingMax !== undefined &&
        query.ratingMin > query.ratingMax)
    )
      throw new BadRequestException("Неверный диапазон фильтров")
    const sent = own && (query as OwnReviewsQueryDto).direction === "sent"
    const filters = [
      sent
        ? Prisma.sql`rv."authorId" = ${userId}::uuid`
        : Prisma.sql`rv."recipientId" = ${userId}::uuid`,
    ]
    if (!own) filters.push(Prisma.sql`u."status" = 'ACTIVE'`)
    if (query.recipientRole)
      filters.push(Prisma.sql`${role} = ${query.recipientRole}`)
    if (query.ratingMin !== undefined)
      filters.push(Prisma.sql`rv."rating" >= ${query.ratingMin}`)
    if (query.ratingMax !== undefined)
      filters.push(Prisma.sql`rv."rating" <= ${query.ratingMax}`)
    if (from) filters.push(Prisma.sql`rv."createdAt" >= ${from}`)
    if (to) filters.push(Prisma.sql`rv."createdAt" <= ${to}`)
    if (query.q) {
      const text = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`
      filters.push(
        Prisma.sql`(rv."comment" ILIKE ${text} OR a."fullName" ILIKE ${text} OR u."fullName" ILIKE ${text})`
      )
    }
    const where = Prisma.sql`${valid} AND ${Prisma.join(filters, " AND ")}`
    const order =
      query.sort === "oldest"
        ? Prisma.sql`rv."createdAt" ASC, rv."id" ASC`
        : Prisma.sql`rv."createdAt" DESC, rv."id" DESC`
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          if (
            !own &&
            !(await tx.user.findFirst({
              where: { id: userId, status: "ACTIVE" },
              select: { id: true },
            }))
          )
            throw new NotFoundException("Пользователь не найден")
          const items = await tx.$queryRaw<
            OwnReviewsListDto["items"]
          >(Prisma.sql`SELECT rv."id", rv."rating", rv."comment", rv."createdAt", ${role} AS "recipientRole",
          jsonb_build_object('id', a."id", 'fullName', a."fullName") AS "author", jsonb_build_object('id', u."id", 'fullName', u."fullName") AS "recipient"
          ${own ? Prisma.sql`, rv."bookingId"` : Prisma.empty} ${where} ORDER BY ${order} LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`)
          const counts = await tx.$queryRaw<{ total: number }[]>(
            Prisma.sql`SELECT COUNT(*)::integer AS total ${where}`
          )
          return {
            items,
            total: counts[0]!.total,
            page: query.page,
            pageSize: query.pageSize,
          }
        },
        { isolationLevel: "RepeatableRead" }
      )
    } catch (error) {
      return this.fail(error)
    }
  }
  async ratings(userId: string): Promise<UserRatingsDto> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          if (
            !(await tx.user.findFirst({
              where: { id: userId, status: "ACTIVE" },
              select: { id: true },
            }))
          )
            throw new NotFoundException("Пользователь не найден")
          const rows = await tx.$queryRaw<
            { role: string; average: number; count: number }[]
          >(
            Prisma.sql`SELECT ${role} AS role, ROUND(AVG(rv."rating")::numeric, 2)::double precision AS average, COUNT(*)::integer AS count ${valid} AND rv."recipientId" = ${userId}::uuid GROUP BY ${role}`
          )
          const rating = (name: string) => {
            const row = rows.find((item) => item.role === name)
            return { average: row?.average ?? null, count: row?.count ?? 0 }
          }
          return { driver: rating("DRIVER"), passenger: rating("PASSENGER") }
        },
        { isolationLevel: "RepeatableRead" }
      )
    } catch (error) {
      return this.fail(error)
    }
  }
  private fail(error: unknown): never {
    if (error instanceof HttpException) throw error
    throw new ServiceUnavailableException("Отзывы временно недоступны")
  }
}
