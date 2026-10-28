import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common"
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
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
import { CreateVehicleDto } from "../users/driver.dto.js"
import {
  UpdateVehicleDto,
  VehicleDto,
  VehicleListDto,
  VehicleQueryDto,
} from "./vehicle.dto.js"
import { VehiclesService } from "./vehicles.service.js"

const validation = (
  expectedType:
    typeof CreateVehicleDto | typeof UpdateVehicleDto | typeof VehicleQueryDto
) =>
  new ValidationPipe({
    expectedType,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  })

@ApiTags("Автомобили")
@ApiCookieAuth(SESSION_COOKIE)
@ApiUnauthorizedResponse({
  description: "Нет действующей сессии или аккаунт заблокирован",
})
@ApiForbiddenResponse({ description: "Нет роли DRIVER или не разрешён Origin" })
@ApiBadRequestResponse({
  description: "Неверные или лишние поля, параметры либо UUID",
})
@ApiResponse({ status: 503, description: "Автомобили временно недоступны" })
@Roles("DRIVER")
@Controller("me/vehicles")
export class VehiclesController {
  constructor(
    @Inject(VehiclesService) private readonly vehicles: VehiclesService
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Найти свои автомобили с фильтрами и пагинацией" })
  @ApiOkResponse({ type: VehicleListDto })
  list(
    @Req() request: SessionRequest,
    @Query(validation(VehicleQueryDto)) query: VehicleQueryDto
  ): Promise<VehicleListDto> {
    return this.vehicles.list(request.currentUser.id, query)
  }

  @Post()
  @UseGuards(TrustedOriginGuard)
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Добавить свой автомобиль" })
  @ApiHeader({
    name: "Origin",
    required: true,
    description: "Должен совпадать с WEB_ORIGIN",
  })
  @ApiBody({ type: CreateVehicleDto })
  @ApiCreatedResponse({ type: VehicleDto })
  @ApiConflictResponse({ description: "Госномер занят" })
  create(
    @Req() request: SessionRequest,
    @Body(validation(CreateVehicleDto)) input: CreateVehicleDto
  ): Promise<VehicleDto> {
    return this.vehicles.create(request.currentUser.id, input)
  }

  @Patch(":id")
  @UseGuards(TrustedOriginGuard)
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Частично изменить свой автомобиль" })
  @ApiHeader({
    name: "Origin",
    required: true,
    description: "Должен совпадать с WEB_ORIGIN",
  })
  @ApiBody({ type: UpdateVehicleDto })
  @ApiOkResponse({ type: VehicleDto })
  @ApiNotFoundResponse({
    description: "Автомобиль отсутствует или принадлежит другому пользователю",
  })
  @ApiConflictResponse({ description: "Госномер занят" })
  update(
    @Req() request: SessionRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(validation(UpdateVehicleDto)) input: UpdateVehicleDto
  ): Promise<VehicleDto> {
    return this.vehicles.update(request.currentUser.id, id, input)
  }
}
