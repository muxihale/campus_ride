import {
  Controller,
  Get,
  Header,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  ValidationPipe,
} from "@nestjs/common"
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
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
import { RideListDto, RideQueryDto } from "./ride-query.dto.js"
import { RideDto } from "./ride.dto.js"
import { RidesService } from "./rides.service.js"

@ApiTags("Поездки водителя")
@ApiCookieAuth(SESSION_COOKIE)
@ApiUnauthorizedResponse({
  description: "Нет действующей сессии или аккаунт заблокирован",
})
@ApiForbiddenResponse({ description: "Нет роли DRIVER" })
@ApiBadRequestResponse({
  description: "Неверные или лишние параметры либо UUID",
})
@ApiResponse({ status: 503, description: "Поездки временно недоступны" })
@Roles("DRIVER")
@Controller("me/rides")
export class OwnRidesController {
  constructor(@Inject(RidesService) private readonly rides: RidesService) {}
  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Найти свои поездки всех статусов",
    description:
      "Поиск по условиям, точкам и автомобилю; фильтры объединяются через И. minSeats — предложенное число мест, не свободный остаток.",
  })
  @ApiOkResponse({ type: RideListDto })
  list(
    @Req() request: SessionRequest,
    @Query(
      new ValidationPipe({
        expectedType: RideQueryDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    )
    query: RideQueryDto
  ): Promise<RideListDto> {
    return this.rides.list(request.currentUser.id, query)
  }
  @Get(":id")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Получить свою поездку по UUID" })
  @ApiOkResponse({ type: RideDto })
  @ApiNotFoundResponse({
    description: "Поездка отсутствует или принадлежит другому водителю",
  })
  detail(
    @Req() request: SessionRequest,
    @Param("id", new ParseUUIDPipe()) id: string
  ): Promise<RideDto> {
    return this.rides.detail(request.currentUser.id, id)
  }
}
