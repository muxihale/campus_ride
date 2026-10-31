import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common"
import { PrismaService } from "../prisma/prisma.service.js"
import type { Prisma } from "../generated/prisma/client.js"
import type {
  NotificationDto,
  NotificationsListDto,
  NotificationsQueryDto,
} from "./notification.dto.js"
const select = {
  id: true,
  kind: true,
  title: true,
  body: true,
  link: true,
  resourceType: true,
  resourceId: true,
  readAt: true,
  createdAt: true,
} as const
@Injectable()
export class NotificationsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async list(
    userId: string,
    query: NotificationsQueryDto
  ): Promise<NotificationsListDto> {
    const from = query.dateFrom ? new Date(query.dateFrom) : undefined,
      to = query.dateTo ? new Date(query.dateTo) : undefined
    if (from && to && from > to)
      throw new BadRequestException("Начало диапазона позже конца")
    const text = query.q
      ? { contains: query.q, mode: "insensitive" as const }
      : undefined
    const where: Prisma.NotificationWhereInput = {
      userId,
      kind: query.kind,
      resourceType: query.resourceType,
      createdAt: { gte: from, lte: to },
      ...(query.read === undefined
        ? {}
        : { readAt: query.read ? { not: null } : null }),
      ...(text ? { OR: [{ title: text }, { body: text }] } : {}),
    }
    try {
      const [items, total] = await this.prisma.$transaction(
        [
          this.prisma.notification.findMany({
            where,
            select,
            orderBy: [{ createdAt: "desc" }, { id: "asc" }],
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
          }),
          this.prisma.notification.count({ where }),
        ],
        { isolationLevel: "RepeatableRead" }
      )
      return { items, total, page: query.page, pageSize: query.pageSize }
    } catch {
      throw new ServiceUnavailableException("Уведомления временно недоступны")
    }
  }
  async read(userId: string, id: string): Promise<NotificationDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.notification.updateMany({
          where: { id, userId, readAt: null },
          data: { readAt: new Date() },
        })
        const item = await tx.notification.findFirst({
          where: { id, userId },
          select,
        })
        if (!item) throw new NotFoundException("Уведомление не найдено")
        return item
      })
    } catch (error) {
      if (error instanceof HttpException) throw error
      throw new ServiceUnavailableException("Уведомления временно недоступны")
    }
  }
}
