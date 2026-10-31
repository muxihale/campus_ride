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
import { SESSION_COOKIE } from "../auth/auth.service.js"
import { Roles } from "../auth/roles.decorator.js"
import type { SessionRequest } from "../auth/session.guard.js"
import {
  DriverBookingListDto,
  DriverBookingsQueryDto,
} from "./driver-bookings.dto.js"
import { DriverBookingsService } from "./driver-bookings.service.js"
@ApiTags("Заявки водителя")
@ApiCookieAuth(SESSION_COOKIE)
@Roles("DRIVER")
@Controller("me/ride-bookings")
export class DriverBookingsController {
  constructor(
    @Inject(DriverBookingsService)
    private readonly bookings: DriverBookingsService
  ) {}
  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Заявки пассажиров собственных поездок",
    description:
      "Поиск по маршруту, пассажиру, автомобилю и причине отклонения. Фильтры объединяются через И. Предстоящие: PENDING/CONFIRMED будущей PUBLISHED-поездки; история — остальные заявки.",
  })
  @ApiOkResponse({ type: DriverBookingListDto })
  @ApiBadRequestResponse({
    description: "Неверные/лишние параметры или обратный диапазон",
  })
  @ApiUnauthorizedResponse({ description: "Нет действующей сессии" })
  @ApiForbiddenResponse({ description: "Нет роли DRIVER" })
  @ApiResponse({ status: 503, description: "Заявки временно недоступны" })
  list(
    @Req() request: SessionRequest,
    @Query(
      new ValidationPipe({
        expectedType: DriverBookingsQueryDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    )
    query: DriverBookingsQueryDto
  ): Promise<DriverBookingListDto> {
    return this.bookings.list(request.currentUser.id, query)
  }
}
