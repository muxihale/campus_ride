import {
  Body,
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
import { CreateRideDto, RideDto } from "./ride.dto.js"
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
}
