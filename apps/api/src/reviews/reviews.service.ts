import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common"
import { PrismaService } from "../prisma/prisma.service.js"
import type { Role } from "../generated/prisma/enums.js"
import type { CreateReviewDto, ReviewDto } from "./review.dto.js"

@Injectable()
export class ReviewsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async create(
    authorId: string,
    roles: Role[],
    bookingId: string,
    input: CreateReviewDto
  ): Promise<ReviewDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Та же блокировка, что у команд жизненного цикла: проверка завершения и запись атомарны.
        const locked = await tx.$queryRaw<
          { id: string }[]
        >`SELECT r."id" FROM "Ride" r JOIN "Booking" b ON b."rideId" = r."id" WHERE b."id" = ${bookingId}::uuid AND (b."passengerId" = ${authorId}::uuid OR r."driverId" = ${authorId}::uuid) FOR UPDATE OF r`
        if (!locked.length) throw new NotFoundException("Заявка не найдена")
        const booking = await tx.booking.findUniqueOrThrow({
          where: { id: bookingId },
          include: { ride: true },
        })
        const passenger = booking.passengerId === authorId
        if (!roles.includes(passenger ? "PASSENGER" : "DRIVER"))
          throw new ForbiddenException(
            "Недостаточно прав для отзыва в этой роли"
          )
        const recipientId = passenger
          ? booking.ride.driverId
          : booking.passengerId
        if (authorId === recipientId)
          throw new ConflictException("Нельзя оставить отзыв самому себе")
        const { startedAt, completedAt } = booking.ride
        if (
          booking.status !== "COMPLETED" ||
          booking.ride.status !== "COMPLETED" ||
          !startedAt ||
          !completedAt ||
          completedAt < startedAt ||
          completedAt > new Date()
        )
          throw new ConflictException(
            "Отзыв доступен только после завершённой поездки и заявки"
          )
        if (
          await tx.review.findUnique({
            where: { bookingId_authorId: { bookingId, authorId } },
          })
        )
          throw new ConflictException("Вы уже оставили отзыв по этой заявке")
        return tx.review.create({
          data: {
            bookingId,
            authorId,
            recipientId,
            rating: input.rating,
            comment: input.comment,
          },
          select: {
            id: true,
            bookingId: true,
            authorId: true,
            recipientId: true,
            rating: true,
            comment: true,
            createdAt: true,
          },
        })
      })
    } catch (error) {
      if (error instanceof HttpException) throw error
      throw new ServiceUnavailableException(
        "Создание отзыва временно недоступно"
      )
    }
  }
}
