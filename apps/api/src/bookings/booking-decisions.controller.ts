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
import { SESSION_COOKIE } from "../auth/auth.service.js"
import { Roles } from "../auth/roles.decorator.js"
import type { SessionRequest } from "../auth/session.guard.js"
import { TrustedOriginGuard } from "../auth/trusted-origin.guard.js"
import {
  BookingDecisionDto,
  ConfirmBookingDto,
  RejectBookingDto,
} from "./booking.dto.js"
import { BookingsService } from "./bookings.service.js"
@ApiTags("Бронирования")
@ApiCookieAuth(SESSION_COOKIE)
@Roles("DRIVER")
@UseGuards(TrustedOriginGuard)
@ApiHeader({
  name: "Origin",
  required: true,
  description: "Должен совпадать с WEB_ORIGIN",
})
@ApiBadRequestResponse({ description: "Неверный UUID, тело или причина" })
@ApiUnauthorizedResponse({ description: "Нет действующей сессии" })
@ApiForbiddenResponse({ description: "Нет роли DRIVER или неверный Origin" })
@ApiNotFoundResponse({
  description: "Заявка отсутствует или принадлежит чужой поездке",
})
@ApiConflictResponse({
  description:
    "Недопустимый статус, поездка уже отправилась или конфликт повторного решения",
})
@ApiResponse({
  status: 503,
  description: "Решение по заявке временно недоступно",
})
@Controller("bookings")
export class BookingDecisionsController {
  constructor(
    @Inject(BookingsService) private readonly bookings: BookingsService
  ) {}
  @Post(":id/confirm")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Подтвердить ожидающую заявку своей поездки",
    description:
      "PENDING → CONFIRMED до отправления. Резерв мест сохраняется. Повтор не создаёт новое событие. Платёж добавляется отдельным этапом.",
  })
  @ApiBody({ type: ConfirmBookingDto, required: false })
  @ApiOkResponse({ type: BookingDecisionDto })
  confirm(
    @Req() request: SessionRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(
      new ValidationPipe({
        expectedType: ConfirmBookingDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    )
    _input: ConfirmBookingDto
  ): Promise<BookingDecisionDto> {
    return this.bookings.decide(request.currentUser.id, id, "CONFIRMED", null)
  }
  @Post(":id/reject")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Отклонить ожидающую заявку своей поездки",
    description:
      "PENDING → REJECTED освобождает резерв. Причина сохраняется в заявке и событии; повтор с той же причиной не создаёт новое событие.",
  })
  @ApiBody({ type: RejectBookingDto })
  @ApiOkResponse({ type: BookingDecisionDto })
  reject(
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
  ): Promise<BookingDecisionDto> {
    return this.bookings.decide(
      request.currentUser.id,
      id,
      "REJECTED",
      input.reason
    )
  }
}
