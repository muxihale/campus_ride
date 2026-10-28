import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Patch,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common"
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger"
import { SESSION_COOKIE } from "../auth/auth.service.js"
import { SessionGuard, type SessionRequest } from "../auth/session.guard.js"
import { TrustedOriginGuard } from "../auth/trusted-origin.guard.js"
import { ProfileDto, UpdateProfileDto } from "./profile.dto.js"
import { Roles } from "../auth/roles.decorator.js"
import { BecomeDriverDto } from "./driver.dto.js"
import { UsersService } from "./users.service.js"

@ApiTags("Профиль")
@ApiCookieAuth(SESSION_COOKIE)
@ApiUnauthorizedResponse({
  description: "Нет действующей сессии или аккаунт заблокирован",
})
@ApiResponse({ status: 503, description: "Профиль временно недоступен" })
@UseGuards(SessionGuard)
@Controller("me")
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Получить собственный профиль" })
  @ApiOkResponse({ type: ProfileDto })
  profile(@Req() request: SessionRequest): Promise<ProfileDto> {
    return this.users.profile(request.currentUser.id)
  }

  @Post("driver-profile")
  @Roles("PASSENGER")
  @UseGuards(TrustedOriginGuard)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Подключить роль водителя и добавить первый автомобиль",
  })
  @ApiHeader({
    name: "Origin",
    required: true,
    description: "Должен совпадать с WEB_ORIGIN",
  })
  @ApiBody({ type: BecomeDriverDto })
  @ApiCreatedResponse({
    type: ProfileDto,
    description:
      "Обновлённый пользователь с ролью DRIVER; роль пассажира сохранена",
  })
  @ApiBadRequestResponse({
    description: "Неверные или лишние поля, включая вложенный автомобиль",
  })
  @ApiForbiddenResponse({
    description: "Нет роли пассажира или не разрешён Origin",
  })
  @ApiConflictResponse({
    description: "Профиль водителя уже создан или госномер занят",
  })
  becomeDriver(
    @Req() request: SessionRequest,
    @Body(
      new ValidationPipe({
        expectedType: BecomeDriverDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    )
    input: BecomeDriverDto
  ): Promise<ProfileDto> {
    return this.users.becomeDriver(request.currentUser.id, input)
  }

  @Patch()
  @UseGuards(TrustedOriginGuard)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Изменить имя, телефон и принадлежность своего профиля",
  })
  @ApiHeader({
    name: "Origin",
    required: true,
    description: "Должен совпадать с WEB_ORIGIN",
  })
  @ApiBody({ type: UpdateProfileDto })
  @ApiOkResponse({ type: ProfileDto })
  @ApiBadRequestResponse({ description: "Неверные или лишние поля" })
  @ApiForbiddenResponse({ description: "Origin не разрешён или отсутствует" })
  update(
    @Req() request: SessionRequest,
    @Body(
      new ValidationPipe({
        expectedType: UpdateProfileDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    )
    input: UpdateProfileDto
  ): Promise<ProfileDto> {
    return this.users.profile(request.currentUser.id, input)
  }
}
