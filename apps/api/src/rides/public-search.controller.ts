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
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger"
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
}
