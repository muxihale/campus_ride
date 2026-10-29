import {
  Body,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Controller,
  Header,
  Inject,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common"
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
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
import { CreateRideDto, RideDto, UpdateRideDto } from "./ride.dto.js"
import { RidesService } from "./rides.service.js"

@ApiTags("Поездки")
@ApiCookieAuth(SESSION_COOKIE)
@Roles("DRIVER")
@Controller("rides")
export class RidesController {
  constructor(@Inject(RidesService) private readonly rides: RidesService) {}

  @Post()
  @UseGuards(TrustedOriginGuard)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Создать полностью заполненный черновик поездки",
    description:
      "Статус DRAFT и автор назначаются сервером. Автомобиль должен принадлежать текущему водителю. Время — в будущем, места — в пределах вместимости.",
  })
  @ApiHeader({
    name: "Origin",
    required: true,
    description: "Должен совпадать с WEB_ORIGIN",
  })
  @ApiBody({ type: CreateRideDto })
  @ApiCreatedResponse({ type: RideDto })
  @ApiBadRequestResponse({
    description: "Неверные/лишние поля, маршрут, время или число мест",
  })
  @ApiUnauthorizedResponse({
    description: "Нет действующей сессии или аккаунт заблокирован",
  })
  @ApiForbiddenResponse({
    description: "Нет роли DRIVER или не разрешён Origin",
  })
  @ApiNotFoundResponse({
    description: "Автомобиль отсутствует или принадлежит другому пользователю",
  })
  @ApiResponse({
    status: 503,
    description: "Создание поездки временно недоступно",
  })
  create(
    @Req() request: SessionRequest,
    @Body(
      new ValidationPipe({
        expectedType: CreateRideDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    )
    input: CreateRideDto
  ): Promise<RideDto> {
    return this.rides.create(request.currentUser.id, input)
  }
  @Patch(":id")
  @UseGuards(TrustedOriginGuard)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Частично изменить собственный черновик без бронирований",
  })
  @ApiHeader({
    name: "Origin",
    required: true,
    description: "Должен совпадать с WEB_ORIGIN",
  })
  @ApiBody({ type: UpdateRideDto })
  @ApiOkResponse({ type: RideDto })
  @ApiBadRequestResponse({ description: "Неверные поля или условия поездки" })
  @ApiUnauthorizedResponse({ description: "Нет действующей сессии" })
  @ApiForbiddenResponse({
    description: "Нет роли DRIVER или не разрешён Origin",
  })
  @ApiNotFoundResponse({
    description: "Поездка или свой автомобиль не найдены",
  })
  @ApiConflictResponse({
    description: "Поездка не черновик или есть бронирования",
  })
  @ApiResponse({ status: 503, description: "Поездки временно недоступны" })
  update(
    @Req() request: SessionRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(
      new ValidationPipe({
        expectedType: UpdateRideDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    )
    input: UpdateRideDto
  ): Promise<RideDto> {
    return this.rides.update(request.currentUser.id, id, input)
  }

  @Delete(":id")
  @HttpCode(204)
  @UseGuards(TrustedOriginGuard)
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Удалить собственный черновик без бронирований" })
  @ApiHeader({
    name: "Origin",
    required: true,
    description: "Должен совпадать с WEB_ORIGIN",
  })
  @ApiNoContentResponse({ description: "Черновик и его остановки удалены" })
  @ApiBadRequestResponse({ description: "Неверный UUID" })
  @ApiUnauthorizedResponse({ description: "Нет действующей сессии" })
  @ApiForbiddenResponse({
    description: "Нет роли DRIVER или не разрешён Origin",
  })
  @ApiNotFoundResponse({
    description: "Поездка отсутствует или принадлежит другому водителю",
  })
  @ApiConflictResponse({
    description: "Поездка не черновик или есть связанные данные",
  })
  @ApiResponse({ status: 503, description: "Поездки временно недоступны" })
  remove(
    @Req() request: SessionRequest,
    @Param("id", new ParseUUIDPipe()) id: string
  ): Promise<void> {
    return this.rides.remove(request.currentUser.id, id)
  }
}
