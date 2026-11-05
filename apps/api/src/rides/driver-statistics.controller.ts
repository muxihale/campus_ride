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
import { Roles } from "../auth/roles.decorator.js"
import { SESSION_COOKIE } from "../auth/auth.service.js"
import type { SessionRequest } from "../auth/session.guard.js"
import { DriverStatisticsService } from "./driver-statistics.service.js"
import {
  DriverStatisticsDto,
  DriverStatisticsQueryDto,
} from "./driver-statistics.dto.js"
@ApiTags("Статистика водителя")
@ApiCookieAuth(SESSION_COOKIE)
@Roles("DRIVER")
@Controller("me/driver-statistics")
export class DriverStatisticsController {
  constructor(
    @Inject(DriverStatisticsService)
    private readonly statistics: DriverStatisticsService
  ) {}
  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Собственная статистика водителя за период отправления",
    description:
      "Все показатели относятся к поездкам текущего водителя с departureAt между dateFrom/dateTo включительно. Без границ — все сохранившиеся поездки. Перевезённые пассажиры — уникальные аккаунты завершённых заявок завершённых поездок; места считаются отдельно. Демо-поступления включают сохранённые успешные оплаты подтверждённых и завершённых участий; возвраты уже исключены. Денежные суммы передаются строками целых копеек без потери точности. Реальных денег нет.",
  })
  @ApiOkResponse({ type: DriverStatisticsDto })
  @ApiBadRequestResponse({
    description: "Неверные параметры или обратный период",
  })
  @ApiUnauthorizedResponse({
    description: "Нет действующей сессии или аккаунт заблокирован",
  })
  @ApiForbiddenResponse({
    description: "Нет DRIVER, в том числе у администратора без этой роли",
  })
  @ApiResponse({
    status: 503,
    description: "Статистика водителя временно недоступна",
  })
  get(
    @Req() request: SessionRequest,
    @Query(
      new ValidationPipe({
        expectedType: DriverStatisticsQueryDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    )
    query: DriverStatisticsQueryDto
  ): Promise<DriverStatisticsDto> {
    return this.statistics.get(request.currentUser.id, query)
  }
}
