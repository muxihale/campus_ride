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
  ApiProperty,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger"
import { Roles } from "../auth/roles.decorator.js"
import { SESSION_COOKIE } from "../auth/auth.service.js"
import type { SessionRequest } from "../auth/session.guard.js"
import { TrustedOriginGuard } from "../auth/trusted-origin.guard.js"
import { RideStartService } from "./ride-start.service.js"
export class StartRideDto {}
export class StartedRideDto {
  @ApiProperty({ type: String, format: "uuid" }) id!: string
  @ApiProperty({ enum: ["IN_PROGRESS"] }) status!: "IN_PROGRESS"
  @ApiProperty({ type: String, format: "date-time" }) startedAt!: Date
}
@ApiTags("Поездки")
@ApiCookieAuth(SESSION_COOKIE)
@Roles("DRIVER")
@Controller("rides")
export class RideStartController {
  constructor(
    @Inject(RideStartService) private readonly rides: RideStartService
  ) {}
  @Post(":id/start")
  @HttpCode(200)
  @UseGuards(TrustedOriginGuard)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Начать свою опубликованную поездку",
    description:
      "Ручной старт PUBLISHED → IN_PROGRESS с серверным startedAt и событием статуса. Повтор сохраняет время и не создаёт событие. На этапе 02.1 ожидающие заявки блокируют старт; обработка добавляется в 02.2. Время отправления может быть будущим или прошедшим.",
  })
  @ApiHeader({ name: "Origin", required: true })
  @ApiBody({ type: StartRideDto, required: false })
  @ApiOkResponse({ type: StartedRideDto })
  @ApiBadRequestResponse({ description: "Неверный UUID или лишние поля" })
  @ApiUnauthorizedResponse({
    description: "Нет действующей сессии или аккаунт заблокирован",
  })
  @ApiForbiddenResponse({ description: "Нет роли DRIVER или неверный Origin" })
  @ApiNotFoundResponse({ description: "Чужая либо отсутствующая поездка" })
  @ApiConflictResponse({
    description:
      "Неподходящий статус, время начала уже задано или есть ожидающие заявки",
  })
  @ApiResponse({
    status: 503,
    description: "Начало поездки временно недоступно",
  })
  start(
    @Req() request: SessionRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(
      new ValidationPipe({
        expectedType: StartRideDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    )
    _input: StartRideDto
  ): Promise<StartedRideDto> {
    return this.rides.start(request.currentUser.id, id)
  }
}
