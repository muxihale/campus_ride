import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common"
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger"
import { SESSION_COOKIE } from "../auth/auth.service.js"
import { Roles } from "../auth/roles.decorator.js"
import type { SessionRequest } from "../auth/session.guard.js"
import { TrustedOriginGuard } from "../auth/trusted-origin.guard.js"
import {
  NotificationDto,
  NotificationsListDto,
  NotificationsQueryDto,
  ReadNotificationDto,
} from "./notification.dto.js"
import { NotificationsService } from "./notifications.service.js"
@ApiTags("Уведомления")
@ApiCookieAuth(SESSION_COOKIE)
@Roles("PASSENGER", "DRIVER", "ADMIN")
@ApiUnauthorizedResponse({ description: "Нет действующей сессии" })
@ApiForbiddenResponse({
  description: "Нет разрешённой роли или неверный Origin",
})
@ApiBadRequestResponse({ description: "Неверный UUID, параметры или тело" })
@ApiResponse({ status: 503, description: "Уведомления временно недоступны" })
@Controller("notifications")
export class NotificationsController {
  constructor(
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService
  ) {}
  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Поиск собственных уведомлений",
    description:
      "Фильтры kind, read, resourceType, dateFrom и dateTo объединяются через И; q ищет по заголовку и тексту.",
  })
  @ApiOkResponse({ type: NotificationsListDto })
  list(
    @Req() request: SessionRequest,
    @Query(
      new ValidationPipe({
        expectedType: NotificationsQueryDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    )
    query: NotificationsQueryDto
  ): Promise<NotificationsListDto> {
    return this.notifications.list(request.currentUser.id, query)
  }
  @Patch(":id/read")
  @UseGuards(TrustedOriginGuard)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Пометить своё уведомление прочитанным",
    description: "Повтор сохраняет прежнее readAt.",
  })
  @ApiHeader({ name: "Origin", required: true })
  @ApiBody({ type: ReadNotificationDto, required: false })
  @ApiOkResponse({ type: NotificationDto })
  @ApiNotFoundResponse({
    description: "Уведомление отсутствует или принадлежит другому пользователю",
  })
  read(
    @Req() request: SessionRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(
      new ValidationPipe({
        expectedType: ReadNotificationDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    )
    _input: ReadNotificationDto
  ): Promise<NotificationDto> {
    return this.notifications.read(request.currentUser.id, id)
  }
}
