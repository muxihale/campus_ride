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
import { RejectBookingDto } from "../bookings/booking.dto.js"
import { RideCancellationService } from "./ride-cancellation.service.js"
class CancelledRideDto {
  @ApiProperty({ type: String, format: "uuid" }) id!: string
  @ApiProperty({ enum: ["CANCELLED"] }) status!: string
  @ApiProperty({ type: String }) cancellationReason!: string
}
@ApiTags("Поездки")
@ApiCookieAuth(SESSION_COOKIE)
@Roles("DRIVER")
@Controller("rides")
export class RideCancellationController {
  constructor(
    @Inject(RideCancellationService)
    private readonly rides: RideCancellationService
  ) {}
  @Post(":id/cancel")
  @HttpCode(200)
  @UseGuards(TrustedOriginGuard)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Отменить свою поездку и вернуть демо-платежи пассажирам",
    description:
      "Только DRAFT/PUBLISHED. Все активные заявки, платежи, события и уведомления меняются атомарно. Повтор с той же причиной не создаёт дублей.",
  })
  @ApiHeader({ name: "Origin", required: true })
  @ApiBody({ type: RejectBookingDto })
  @ApiOkResponse({ type: CancelledRideDto })
  @ApiBadRequestResponse({ description: "Неверные поля или UUID" })
  @ApiUnauthorizedResponse({ description: "Нет сессии" })
  @ApiForbiddenResponse({ description: "Нет роли DRIVER или неверный Origin" })
  @ApiNotFoundResponse({ description: "Чужая или отсутствующая поездка" })
  @ApiConflictResponse({
    description: "Недопустимый статус или конфликт причины",
  })
  @ApiResponse({ status: 503, description: "Отмена временно недоступна" })
  cancel(
    @Req() request: SessionRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(
      new ValidationPipe({
        expectedType: RejectBookingDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    )
    input: RejectBookingDto
  ): Promise<CancelledRideDto> {
    return this.rides.cancel(request.currentUser.id, id, input.reason)
  }
}
