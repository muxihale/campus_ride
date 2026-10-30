import {
  Controller,
  Get,
  Header,
  Inject,
  Query,
  Param,
  ParseUUIDPipe,
  ValidationPipe,
} from "@nestjs/common"
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger"
import { PublicRideDetailDto } from "./public-detail.dto.js"
import { PublicRideListDto, PublicSearchDto } from "./public-search.dto.js"
import { PublicSearchService } from "./public-search.service.js"
@ApiTags("Публичный поиск поездок")
@Controller("rides")
export class PublicSearchController {
  constructor(
    @Inject(PublicSearchService) private readonly search: PublicSearchService
  ) {}
  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Найти опубликованные будущие поездки",
    description:
      "Без сессии. Только активные водители. Дата и время — Екатеринбург; timeFrom/timeTo требуют date. minSeats проверяет свободный остаток с учётом PENDING/CONFIRMED; заполненные поездки исключаются.",
  })
  @ApiOkResponse({ type: PublicRideListDto })
  @ApiBadRequestResponse({
    description: "Неверные/лишние параметры, дата или диапазон времени",
  })
  @ApiResponse({ status: 503, description: "Поиск временно недоступен" })
  find(
    @Query(
      new ValidationPipe({
        expectedType: PublicSearchDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    )
    query: PublicSearchDto
  ): Promise<PublicRideListDto> {
    return this.search.search(query)
  }
  @Get(":id")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Получить публичную карточку доступной поездки",
    description:
      "Без сессии. Те же ограничения доступности и расчёт остатка, что в поиске. Только публичные данные водителя и автомобиля.",
  })
  @ApiOkResponse({ type: PublicRideDetailDto })
  @ApiBadRequestResponse({ description: "Неверный UUID" })
  @ApiNotFoundResponse({ description: "Поездка отсутствует или недоступна" })
  @ApiResponse({ status: 503, description: "Карточка временно недоступна" })
  detail(
    @Param("id", new ParseUUIDPipe()) id: string
  ): Promise<PublicRideDetailDto> {
    return this.search.detail(id)
  }
}
