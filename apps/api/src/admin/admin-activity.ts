import {
  Controller,
  Get,
  Header,
  Inject,
  Injectable,
  Query,
  Req,
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
} from "@nestjs/swagger"
import { IsIn, IsOptional } from "class-validator"
import { SESSION_COOKIE } from "../auth/auth.service.js"
import { Roles } from "../auth/roles.decorator.js"
import type { SessionRequest } from "../auth/session.guard.js"
import {
  ActivityFiltersDto,
  ActivityDto,
  adminActions,
} from "../activity/activity.dto.js"
import { ActivityService } from "../activity/activity.service.js"
export class AdminActivityQueryDto extends ActivityFiltersDto {
  @ApiPropertyOptional({ enum: adminActions })
  @IsOptional()
  @IsIn(adminActions)
  action?: string
}
export class AdminActivityDto extends ActivityDto {}
export class AdminActivityListDto {
  @ApiProperty({ type: [AdminActivityDto] }) items!: AdminActivityDto[]
  @ApiProperty({ type: Number }) total!: number
  @ApiProperty({ type: Number }) page!: number
  @ApiProperty({ type: Number }) pageSize!: number
}
@Injectable()
export class AdminActivityService {
  constructor(
    @Inject(ActivityService) private readonly activity: ActivityService
  ) {}
  list(
    actorId: string,
    query: AdminActivityQueryDto
  ): Promise<AdminActivityListDto> {
    return this.activity.list(actorId, query, adminActions)
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
