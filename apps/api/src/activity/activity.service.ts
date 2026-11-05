import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common"
import { Prisma } from "../generated/prisma/client.js"
import { PrismaService } from "../prisma/prisma.service.js"
import {
  activityActions,
  type ActivityDto,
  type ActivityFiltersDto,
  type ActivityListDto,
} from "./activity.dto.js"
const reason = Prisma.sql`CASE WHEN jsonb_typeof("details"->'reason') = 'string' THEN "details"->>'reason' ELSE NULL END`
@Injectable()
export class ActivityService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async list(
    actorId: string,
    query: ActivityFiltersDto & { action?: string },
    allowedActions: readonly string[] = activityActions
  ): Promise<ActivityListDto> {
    const from = query.dateFrom ? new Date(query.dateFrom) : undefined,
      to = query.dateTo ? new Date(query.dateTo) : undefined
    if (from && to && from > to)
      throw new BadRequestException("Начало диапазона позже конца")
    const filters = [
      Prisma.sql`"actorId" = ${actorId}::uuid`,
      Prisma.sql`"action" IN (${Prisma.join([...allowedActions])})`,
    ]
    if (query.action) filters.push(Prisma.sql`"action" = ${query.action}`)
    if (query.resourceType)
      filters.push(Prisma.sql`"resourceType" = ${query.resourceType}`)
    if (query.resourceId)
      filters.push(Prisma.sql`"resourceId" = ${query.resourceId}::uuid`)
    if (from) filters.push(Prisma.sql`"createdAt" >= ${from}`)
    if (to) filters.push(Prisma.sql`"createdAt" <= ${to}`)
    if (query.q) {
      const text = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`
      filters.push(
        Prisma.sql`("action" ILIKE ${text} OR "resourceType" ILIKE ${text} OR "resourceId"::text ILIKE ${text} OR (${reason}) ILIKE ${text})`
      )
    }
    const where = Prisma.sql`FROM "ActivityLog" WHERE ${Prisma.join(filters, " AND ")}`
    const order =
      query.sort === "oldest"
        ? Prisma.sql`"createdAt" ASC, "id" ASC`
        : Prisma.sql`"createdAt" DESC, "id" DESC`
    try {
      const [items, counts] = await this.prisma.$transaction(
        [
          this.prisma.$queryRaw<ActivityDto[]>(
            Prisma.sql`SELECT "id", "action", "resourceType", "resourceId", "createdAt", ${reason} AS reason ${where} ORDER BY ${order} LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`
          ),
          this.prisma.$queryRaw<{ total: number }[]>(
            Prisma.sql`SELECT COUNT(*)::integer AS total ${where}`
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
    } catch (error) {
      if (error instanceof HttpException) throw error
      throw new ServiceUnavailableException(
        "История действий временно недоступна"
      )
    }
  }
}
