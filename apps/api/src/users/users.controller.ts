import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Patch,
  Req,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common"
import {
  ApiBadRequestResponse,
  ApiBody,
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
