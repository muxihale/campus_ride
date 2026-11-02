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
import { RideCompletionService } from "./ride-completion.service.js"
export class CompleteRideDto {}
export class CompletedRideDto {
  @ApiProperty({ type: String, format: "uuid" }) id!: string
  @ApiProperty({ enum: ["COMPLETED"] }) status!: "COMPLETED"
  @ApiProperty({ type: String, format: "date-time" }) startedAt!: Date
  @ApiProperty({ type: String, format: "date-time" }) completedAt!: Date
}
@ApiTags("Поездки")
@ApiCookieAuth(SESSION_COOKIE)
@Roles("DRIVER")
@Controller("rides")
export class RideCompletionController {
  constructor(
    @Inject(RideCompletionService) private readonly rides: RideCompletionService
  ) {}
  @Post(":id/complete")
  @HttpCode(200)
  @UseGuards(TrustedOriginGuard)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Завершить свою начатую поездку",
    description:
      "IN_PROGRESS → COMPLETED и все CONFIRMED → COMPLETED в одной транзакции с событиями статусов. Успешные демо-платежи сохраняются. Повтор не меняет время и не создаёт события. UI и уведомления добавляются отдельными этапами.",
  })
  @ApiHeader({ name: "Origin", required: true })
  @ApiBody({ type: CompleteRideDto, required: false })
  @ApiOkResponse({ type: CompletedRideDto })
  @ApiBadRequestResponse({ description: "Неверный UUID или лишние поля" })
  @ApiUnauthorizedResponse({
    description: "Нет действующей сессии или аккаунт заблокирован",
  })
  @ApiForbiddenResponse({ description: "Нет роли DRIVER или неверный Origin" })
  @ApiNotFoundResponse({ description: "Чужая либо отсутствующая поездка" })
  @ApiConflictResponse({
    description:
      "Недопустимый статус, timestamps, ожидающая заявка или некорректный демо-платёж",
  })
  @ApiResponse({
    status: 503,
    description: "Завершение поездки временно недоступно",
  })
  complete(
    @Req() request: SessionRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(
      new ValidationPipe({
        expectedType: CompleteRideDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    )
    _input: CompleteRideDto
  ): Promise<CompletedRideDto> {
    return this.rides.complete(request.currentUser.id, id)
  }
}
