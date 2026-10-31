import type { Response } from "express"
import {
  Body,
  Controller,
  Header,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common"
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger"
import { SESSION_COOKIE } from "../auth/auth.service.js"
import { Roles } from "../auth/roles.decorator.js"
import type { SessionRequest } from "../auth/session.guard.js"
import { TrustedOriginGuard } from "../auth/trusted-origin.guard.js"
import { BookingDto, CreateBookingDto } from "./booking.dto.js"
import { BookingsService } from "./bookings.service.js"
@ApiTags("Бронирования")
@ApiCookieAuth(SESSION_COOKIE)
@Roles("PASSENGER")
@Controller("rides/:id/bookings")
export class BookingsController {
  constructor(
    @Inject(BookingsService) private readonly bookings: BookingsService
  ) {}
  @Post()
  @UseGuards(TrustedOriginGuard)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Создать заявку с резервированием мест",
    description:
      "PENDING резервирует места до решения водителя. Цена и пассажир назначаются сервером. Повтор с тем же requestKey и параметрами возвращает прежнюю заявку без повторного резервирования.",
  })
  @ApiHeader({
    name: "Origin",
    required: true,
    description: "Должен совпадать с WEB_ORIGIN",
  })
  @ApiBody({ type: CreateBookingDto })
  @ApiCreatedResponse({
    type: BookingDto,
    description: "Новая заявка",
  })
  @ApiOkResponse({
    type: BookingDto,
    description: "Результат повторной отправки",
  })
  @ApiBadRequestResponse({
    description: "Неверный UUID, число мест или лишние поля",
  })
  @ApiUnauthorizedResponse({ description: "Нет действующей сессии" })
  @ApiForbiddenResponse({
    description: "Нет роли PASSENGER, чужой Origin или собственная поездка",
  })
  @ApiNotFoundResponse({ description: "Поездка отсутствует или недоступна" })
  @ApiConflictResponse({
    description: "Недостаточно мест, активная заявка или конфликт ключа",
  })
  @ApiResponse({ status: 503, description: "Бронирование временно недоступно" })
  async create(
    @Req() request: SessionRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(
      new ValidationPipe({
        expectedType: CreateBookingDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    )
    input: CreateBookingDto
  ): Promise<BookingDto> {
    const result = await this.bookings.create(request.currentUser.id, id, input)
    response.status(result.created ? 201 : 200)
    return result.booking
  }
}
