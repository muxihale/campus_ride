import {
  Controller,
  Get,
  Header,
  Inject,
  Query,
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
import { Roles } from "../auth/roles.decorator.js"
import { SESSION_COOKIE } from "../auth/auth.service.js"
import { AdminUsersListDto, AdminUsersQueryDto } from "./admin-users.dto.js"
import { AdminUsersService } from "./admin-users.service.js"
@ApiTags("Администрирование: пользователи")
@ApiCookieAuth(SESSION_COOKIE)
@Roles("ADMIN")
@Controller("admin/users")
export class AdminUsersController {
  constructor(
    @Inject(AdminUsersService) private readonly users: AdminUsersService
  ) {}
  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Найти пользователей для администратора",
    description:
      "q ищет по имени и email. Роль, статус, даты регистрации и принадлежность к университету объединяются через И. Пароли, сессии и телефон не выдаются. Список и total читаются в одном снимке БД.",
  })
  @ApiOkResponse({ type: AdminUsersListDto })
  @ApiBadRequestResponse({
    description: "Неверные/лишние параметры или обратный диапазон дат",
  })
  @ApiUnauthorizedResponse({
    description: "Нет действующей сессии или аккаунт заблокирован",
  })
  @ApiForbiddenResponse({ description: "Нет роли ADMIN" })
  @ApiResponse({
    status: 503,
    description: "Список пользователей временно недоступен",
  })
  list(
    @Query(
      new ValidationPipe({
        expectedType: AdminUsersQueryDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    )
    query: AdminUsersQueryDto
  ): Promise<AdminUsersListDto> {
    return this.users.list(query)
  }
}
