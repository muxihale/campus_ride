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
import { OwnBookingListDto, OwnBookingsQueryDto } from "./own-bookings.dto.js"
import { OwnBookingsService } from "./own-bookings.service.js"
@ApiTags("Заявки пассажира")
@ApiCookieAuth(SESSION_COOKIE)
@Roles("PASSENGER")
@Controller("me/bookings")
export class OwnBookingsController {
  constructor(
    @Inject(OwnBookingsService) private readonly bookings: OwnBookingsService
  ) {}
  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Поиск своих заявок и истории",
    description:
      "Поиск по маршруту, водителю, автомобилю и причине отклонения. Фильтры объединяются через И. Предстоящие: PENDING/CONFIRMED будущей PUBLISHED-поездки; история — остальные заявки.",
  })
  @ApiOkResponse({ type: OwnBookingListDto })
  @ApiBadRequestResponse({
    description: "Неверные/лишние параметры или обратный диапазон",
  })
  @ApiUnauthorizedResponse({ description: "Нет действующей сессии" })
  @ApiForbiddenResponse({ description: "Нет роли PASSENGER" })
  @ApiResponse({ status: 503, description: "Заявки временно недоступны" })
  list(
    @Req() request: SessionRequest,
    @Query(
      new ValidationPipe({
        expectedType: OwnBookingsQueryDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    )
    query: OwnBookingsQueryDto
  ): Promise<OwnBookingListDto> {
    return this.bookings.list(request.currentUser.id, query)
  }
}
