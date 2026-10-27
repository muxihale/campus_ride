import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { ThrottlerGuard } from "@nestjs/throttler"
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger"
import type { Response } from "express"
import { AuthService, SESSION_COOKIE, SESSION_TTL_MS } from "./auth.service.js"
import { CurrentUserDto, RegisterDto } from "./auth.dto.js"
import { SessionGuard, type SessionRequest } from "./session.guard.js"
import { TrustedOriginGuard } from "./trusted-origin.guard.js"

@ApiTags("Авторизация")
@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ConfigService) private readonly config: ConfigService
  ) {}

  @Post("register")
  @UseGuards(TrustedOriginGuard, ThrottlerGuard)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Зарегистрировать пассажира и создать сессию на 7 дней",
  })
  @ApiHeader({
    name: "Origin",
    required: true,
    description:
      "Должен совпадать с WEB_ORIGIN. Открывайте Swagger через фронтенд /api/docs.",
  })
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({
    type: CurrentUserDto,
    description: "Пользователь и HttpOnly cookie campusride_session",
  })
  @ApiBadRequestResponse({ description: "Неверные или лишние поля" })
  @ApiForbiddenResponse({ description: "Origin не разрешён или отсутствует" })
  @ApiConflictResponse({ description: "Email уже зарегистрирован" })
  @ApiResponse({
    status: 429,
    description: "Не больше 10 попыток регистрации за 60 секунд с одного IP",
  })
  async register(
    @Body(
      new ValidationPipe({
        expectedType: RegisterDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    )
    input: RegisterDto,
    @Res({ passthrough: true }) response: Response
  ): Promise<CurrentUserDto> {
    const result = await this.auth.register(input)
    response.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: this.config.get<string>("NODE_ENV") === "production",
      path: "/",
      maxAge: SESSION_TTL_MS,
      expires: result.expiresAt,
    })
    return result.user
  }

  @Get("me")
  @UseGuards(SessionGuard)
  @Header("Cache-Control", "no-store")
  @ApiCookieAuth(SESSION_COOKIE)
  @ApiOperation({ summary: "Получить текущего пользователя по cookie-сессии" })
  @ApiOkResponse({ type: CurrentUserDto })
  @ApiUnauthorizedResponse({
    description: "Сессия отсутствует, истекла или пользователь заблокирован",
  })
  currentUser(@Req() request: SessionRequest): CurrentUserDto {
    return request.currentUser
  }
}
