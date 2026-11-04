import {
  BadRequestException,
  Controller,
  Get,
  Header,
  HttpException,
  Inject,
  Injectable,
  Query,
  Req,
  ServiceUnavailableException,
  ValidationPipe,
} from "@nestjs/common"
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  PickType,
} from "@nestjs/swagger"
import { IsIn, IsOptional, IsUUID } from "class-validator"
import { Prisma } from "../generated/prisma/client.js"
import { PrismaService } from "../prisma/prisma.service.js"
import { SESSION_COOKIE } from "../auth/auth.service.js"
import { Roles } from "../auth/roles.decorator.js"
import type { SessionRequest } from "../auth/session.guard.js"
import { ReviewsQueryDto } from "../reviews/review-query.dto.js"
export const adminActions = [
  "user.blocked",
  "user.unblocked",
  "review.hidden",
  "review.restored",
  "ride.cancelled",
  "booking.cancelled",
  "payment.cancelled",
  "payment.refunded",
] as const
export class AdminActivityQueryDto extends PickType(ReviewsQueryDto, [
  "q",
  "page",
  "pageSize",
  "dateFrom",
  "dateTo",
  "sort",
] as const) {
  @ApiPropertyOptional({ enum: adminActions })
  @IsOptional()
  @IsIn(adminActions)
  action?: string
  @ApiPropertyOptional({
    enum: ["user", "review", "ride", "booking", "payment"],
  })
  @IsOptional()
  @IsIn(["user", "review", "ride", "booking", "payment"])
  resourceType?: string
  @ApiPropertyOptional({ type: String, format: "uuid" })
  @IsOptional()
  @IsUUID()
  resourceId?: string
}
export class AdminActivityDto {
  @ApiProperty({ type: String, format: "uuid" }) id!: string
  @ApiProperty({ type: String }) action!: string
  @ApiProperty({ type: String }) resourceType!: string
  @ApiProperty({ type: String, format: "uuid" }) resourceId!: string
  @ApiProperty({ type: String, nullable: true }) reason!: string | null
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: Date
}
export class AdminActivityListDto {
  @ApiProperty({ type: [AdminActivityDto] }) items!: AdminActivityDto[]
  @ApiProperty({ type: Number }) total!: number
  @ApiProperty({ type: Number }) page!: number
  @ApiProperty({ type: Number }) pageSize!: number
}
@Injectable()
export class AdminActivityService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async list(
    actorId: string,
    query: AdminActivityQueryDto
  ): Promise<AdminActivityListDto> {
    const from = query.dateFrom ? new Date(query.dateFrom) : undefined,
      to = query.dateTo ? new Date(query.dateTo) : undefined
    if (from && to && from > to)
      throw new BadRequestException("Начало диапазона позже конца")
    const filters = [
      Prisma.sql`"actorId" = ${actorId}::uuid`,
      Prisma.sql`"action" IN (${Prisma.join([...adminActions])})`,
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
        Prisma.sql`("action" ILIKE ${text} OR "resourceType" ILIKE ${text} OR "resourceId"::text ILIKE ${text} OR "details"->>'reason' ILIKE ${text})`
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
          this.prisma.$queryRaw<AdminActivityDto[]>(
            Prisma.sql`SELECT "id", "action", "resourceType", "resourceId", "createdAt", "details"->>'reason' AS reason ${where} ORDER BY ${order} LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`
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
@ApiTags("Администрирование: история действий")
@ApiCookieAuth(SESSION_COOKIE)
@Roles("ADMIN")
@Controller("admin/activity")
export class AdminActivityController {
  constructor(
    @Inject(AdminActivityService)
    private readonly activity: AdminActivityService
  ) {}
  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "История собственных решений администратора и связанных отмен",
    description:
      "Автор определяется сессией; чужие записи недоступны. Поиск по причине, коду действия и объекту. Фильтры action, resourceType, resourceId, dateFrom/dateTo объединяются через И. Возвращается причина без произвольного содержимого details.",
  })
  @ApiOkResponse({ type: AdminActivityListDto })
  @ApiBadRequestResponse({ description: "Неверные параметры или диапазон" })
  @ApiUnauthorizedResponse({ description: "Нет сессии" })
  @ApiForbiddenResponse({ description: "Нет ADMIN" })
  @ApiResponse({
    status: 503,
    description: "История действий временно недоступна",
  })
  list(
    @Req() request: SessionRequest,
    @Query(
      new ValidationPipe({
        expectedType: AdminActivityQueryDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    )
    query: AdminActivityQueryDto
  ): Promise<AdminActivityListDto> {
    return this.activity.list(request.currentUser.id, query)
  }
}
