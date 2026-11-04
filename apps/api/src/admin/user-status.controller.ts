import {
  Body,
  Controller,
  Header,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common"
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
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
import { Roles } from "../auth/roles.decorator.js"
import { SESSION_COOKIE } from "../auth/auth.service.js"
import type { SessionRequest } from "../auth/session.guard.js"
import { TrustedOriginGuard } from "../auth/trusted-origin.guard.js"
import { ChangeUserStatusDto, UserStatusResultDto } from "./user-status.dto.js"
import { UserStatusService } from "./user-status.service.js"
const bodyPipe = () =>
  new ValidationPipe({
    expectedType: ChangeUserStatusDto,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  })
@ApiTags("Администрирование: пользователи")
@ApiCookieAuth(SESSION_COOKIE)
@Roles("ADMIN")
@UseGuards(TrustedOriginGuard)
@ApiHeader({ name: "Origin", required: true })
@ApiOkResponse({ type: UserStatusResultDto })
@ApiBadRequestResponse({
  description: "Неверный UUID, причина или лишние поля",
})
@ApiUnauthorizedResponse({ description: "Нет действующей сессии" })
@ApiForbiddenResponse({ description: "Нет ADMIN или неверный Origin" })
@ApiNotFoundResponse({ description: "Пользователь отсутствует" })
@ApiConflictResponse({
  description: "Собственный аккаунт или некорректный демо-платёж",
})
@ApiResponse({
  status: 503,
  description: "Изменение блокировки временно недоступно",
})
@Controller("admin/users")
export class UserStatusController {
  constructor(
    @Inject(UserStatusService) private readonly users: UserStatusService
  ) {}
  @ApiBody({ type: ChangeUserStatusDto })
  @Post(":id/block")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Заблокировать пользователя и отменить будущие активные участия",
    description:
      "В одной транзакции отзывает все сессии, отменяет будущие DRAFT/PUBLISHED поездки водителя и активные заявки пассажира с демо-возвратами, записывает уведомления и аудит. Начатые, завершённые и прошедшие поездки сохраняются. Повтор текущего статуса не создаёт записей. Самоблокировка запрещена.",
  })
  block(
    @Req() request: SessionRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(bodyPipe()) input: ChangeUserStatusDto
  ): Promise<UserStatusResultDto> {
    return this.users.change(request.currentUser.id, id, true, input.reason)
  }
  @ApiBody({ type: ChangeUserStatusDto })
  @Post(":id/unblock")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Разблокировать пользователя с причиной",
    description:
      "Старые сессии, поездки и заявки не восстанавливаются. Повтор ACTIVE не создаёт новых записей.",
  })
  unblock(
    @Req() request: SessionRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(bodyPipe()) input: ChangeUserStatusDto
  ): Promise<UserStatusResultDto> {
    return this.users.change(request.currentUser.id, id, false, input.reason)
  }
}
