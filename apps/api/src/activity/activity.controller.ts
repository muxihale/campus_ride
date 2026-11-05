import {
  Controller,
  Get,
  Header,
  Inject,
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
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger"
import { Roles } from "../auth/roles.decorator.js"
import { SESSION_COOKIE } from "../auth/auth.service.js"
import type { SessionRequest } from "../auth/session.guard.js"
import { ActivityListDto, ActivityQueryDto } from "./activity.dto.js"
import { ActivityService } from "./activity.service.js"
@ApiTags("История действий")
@ApiCookieAuth(SESSION_COOKIE)
@Roles("PASSENGER", "DRIVER", "ADMIN")
@Controller("me/activity")
export class ActivityController {
  constructor(
    @Inject(ActivityService) private readonly activity: ActivityService
  ) {}
  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Поиск собственных действий для любой роли",
    description:
      "Автор определяется сессией; даже администратор не может запросить чужую историю. Возвращаются разрешённые типы уже записанных действий. q ищет по коду действия, типу/UUID объекта и причине; action, resourceType, resourceId, dateFrom/dateTo объединяются через И. Произвольный JSON details, контакты и секреты не выдаются.",
  })
  @ApiOkResponse({ type: ActivityListDto })
  @ApiBadRequestResponse({ description: "Неверные параметры или диапазон" })
  @ApiUnauthorizedResponse({
    description: "Нет действующей сессии или аккаунт заблокирован",
  })
  @ApiForbiddenResponse({ description: "Нет разрешённой роли" })
  @ApiResponse({
    status: 503,
    description: "История действий временно недоступна",
  })
  list(
    @Req() request: SessionRequest,
    @Query(
      new ValidationPipe({
        expectedType: ActivityQueryDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    )
    query: ActivityQueryDto
  ): Promise<ActivityListDto> {
    return this.activity.list(request.currentUser.id, query)
  }
}
