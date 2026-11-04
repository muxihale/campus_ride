import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common"
import { Prisma } from "../generated/prisma/client.js"
import { PrismaService } from "../prisma/prisma.service.js"
import { lockActiveUser } from "../auth/active-user.js"
import type {
  AdminReviewDto,
  AdminReviewsListDto,
  AdminReviewsQueryDto,
  ReviewModerationResultDto,
} from "./admin-reviews.dto.js"
const role = Prisma.sql`CASE WHEN rv."authorId" = b."passengerId" AND rv."recipientId" = r."driverId" AND b."passengerId" <> r."driverId" THEN 'DRIVER' WHEN rv."authorId" = r."driverId" AND rv."recipientId" = b."passengerId" AND b."passengerId" <> r."driverId" THEN 'PASSENGER' ELSE NULL END`
@Injectable()
export class AdminReviewsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async list(query: AdminReviewsQueryDto): Promise<AdminReviewsListDto> {
    const from = query.dateFrom ? new Date(query.dateFrom) : undefined,
      to = query.dateTo ? new Date(query.dateTo) : undefined
    if (
      (from && to && from > to) ||
      (query.ratingMin !== undefined &&
        query.ratingMax !== undefined &&
        query.ratingMin > query.ratingMax)
    )
      throw new BadRequestException("Неверный диапазон фильтров")
    const filters = [Prisma.sql`true`]
    if (query.hidden !== undefined)
      filters.push(
        query.hidden
          ? Prisma.sql`rv."hiddenAt" IS NOT NULL`
          : Prisma.sql`rv."hiddenAt" IS NULL`
      )
    if (query.recipientRole)
      filters.push(Prisma.sql`${role} = ${query.recipientRole}`)
    if (query.ratingMin !== undefined)
      filters.push(Prisma.sql`rv."rating" >= ${query.ratingMin}`)
    if (query.ratingMax !== undefined)
      filters.push(Prisma.sql`rv."rating" <= ${query.ratingMax}`)
    if (from) filters.push(Prisma.sql`rv."createdAt" >= ${from}`)
    if (to) filters.push(Prisma.sql`rv."createdAt" <= ${to}`)
    if (query.authorId)
      filters.push(Prisma.sql`rv."authorId" = ${query.authorId}::uuid`)
    if (query.recipientId)
      filters.push(Prisma.sql`rv."recipientId" = ${query.recipientId}::uuid`)
    if (query.bookingId)
      filters.push(Prisma.sql`rv."bookingId" = ${query.bookingId}::uuid`)
    if (query.q) {
      const text = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`
      filters.push(
        Prisma.sql`(rv."comment" ILIKE ${text} OR rv."hiddenReason" ILIKE ${text} OR a."fullName" ILIKE ${text} OR u."fullName" ILIKE ${text})`
      )
    }
    const where = Prisma.sql`FROM "Review" rv JOIN "Booking" b ON b."id" = rv."bookingId" JOIN "Ride" r ON r."id" = b."rideId" JOIN "User" a ON a."id" = rv."authorId" JOIN "User" u ON u."id" = rv."recipientId" WHERE ${Prisma.join(filters, " AND ")}`
    const order =
      query.sort === "oldest"
        ? Prisma.sql`rv."createdAt" ASC, rv."id" ASC`
        : Prisma.sql`rv."createdAt" DESC, rv."id" DESC`
    try {
      const [items, count] = await this.prisma.$transaction(
        [
          this.prisma.$queryRaw<AdminReviewDto[]>(
            Prisma.sql`SELECT rv."id", rv."bookingId", rv."authorId", rv."recipientId", rv."rating", rv."comment", rv."createdAt", rv."hiddenAt", rv."hiddenReason", ${role} AS "recipientRole", b."status" AS "bookingStatus", r."status" AS "rideStatus", jsonb_build_object('id', a."id", 'fullName', a."fullName") AS author, jsonb_build_object('id', u."id", 'fullName', u."fullName") AS recipient ${where} ORDER BY ${order} LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`
          ),
          this.prisma.$queryRaw<{ total: number }[]>(
            Prisma.sql`SELECT COUNT(*)::integer AS total ${where}`
          ),
        ],
        { isolationLevel: "RepeatableRead" }
      )
      return {
        items,
        total: count[0]!.total,
        page: query.page,
        pageSize: query.pageSize,
      }
    } catch (error) {
      return this.fail(error)
    }
  }
  async moderate(
    actorId: string,
    id: string,
    hide: boolean,
    reason: string
  ): Promise<ReviewModerationResultDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockActiveUser(tx, actorId)
        if (
          !(await tx.userRole.findUnique({
            where: { userId_role: { userId: actorId, role: "ADMIN" } },
          }))
        )
          throw new ForbiddenException("Недостаточно прав")
        const locked = await tx.$queryRaw<
          { id: string }[]
        >`SELECT "id" FROM "Review" WHERE "id" = ${id}::uuid FOR UPDATE`
        if (!locked.length) throw new NotFoundException("Отзыв не найден")
        const review = await tx.review.findUniqueOrThrow({ where: { id } })
        if (Boolean(review.hiddenAt) === hide)
          return {
            id: review.id,
            hiddenAt: review.hiddenAt,
            hiddenReason: review.hiddenReason,
            changed: false,
          }
        const hiddenAt = hide ? new Date() : null
        const updated = await tx.review.update({
          where: { id },
          data: { hiddenAt, hiddenReason: hide ? reason : null },
          select: { id: true, hiddenAt: true, hiddenReason: true },
        })
        await tx.activityLog.create({
          data: {
            actorId,
            action: hide ? "review.hidden" : "review.restored",
            resourceType: "review",
            resourceId: review.id,
            details: {
              reason,
              bookingId: review.bookingId,
              authorId: review.authorId,
              recipientId: review.recipientId,
              fromHiddenAt: review.hiddenAt?.toISOString() ?? null,
              toHiddenAt: hiddenAt?.toISOString() ?? null,
            },
          },
        })
        for (const userId of new Set([
          review.authorId,
          review.recipientId,
          actorId,
        ])) {
          await tx.notification.create({
            data: {
              userId,
              kind: "SYSTEM",
              title: hide
                ? "Отзыв скрыт администратором"
                : "Отзыв восстановлен администратором",
              body: `Причина: ${reason}. Рейтинг рассчитывается по видимым отзывам завершённых поездок.`,
              resourceType: "review",
              resourceId: review.id,
              link: "#/reviews",
            },
          })
        }
        return { ...updated, changed: true }
      })
    } catch (error) {
      return this.fail(error)
    }
  }
  private fail(error: unknown): never {
    if (error instanceof HttpException) throw error
    throw new ServiceUnavailableException(
      "Модерация отзывов временно недоступна"
    )
  }
}
