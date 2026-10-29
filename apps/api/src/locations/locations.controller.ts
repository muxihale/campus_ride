import { Controller, Get, Inject, Query, ValidationPipe } from "@nestjs/common"
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger"
import {
  CampusQueryDto,
  DistrictQueryDto,
  LocationListDto,
  LocationQueryDto,
  ReferenceListDto,
} from "./location.dto.js"
import { LocationsService } from "./locations.service.js"

const validation = (
  expectedType:
    typeof CampusQueryDto | typeof DistrictQueryDto | typeof LocationQueryDto
) =>
  new ValidationPipe({
    expectedType,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  })

@ApiTags("Справочники маршрутов")
@ApiBadRequestResponse({ description: "Неверные или лишние параметры" })
@ApiResponse({ status: 503, description: "Справочники временно недоступны" })
@Controller()
export class LocationsController {
  constructor(
    @Inject(LocationsService) private readonly locations: LocationsService
  ) {}

  @Get("districts")
  @ApiOperation({
    summary: "Найти районы и микрорайоны Екатеринбурга",
    description:
      "Публичный справочник. Фильтры kind, address, locationName, campusId применяются к одной связанной точке; q — к названию района.",
  })
  @ApiOkResponse({ type: ReferenceListDto })
  districts(
    @Query(validation(DistrictQueryDto)) query: DistrictQueryDto
  ): Promise<ReferenceListDto> {
    return this.locations.districts(query)
  }

  @Get("campuses")
  @ApiOperation({
    summary: "Найти корпуса УрФУ",
    description:
      "Публичный справочник. Фильтры kind, address, locationName, districtId применяются к одной связанной точке; q — к названию корпуса.",
  })
  @ApiOkResponse({ type: ReferenceListDto })
  campuses(
    @Query(validation(CampusQueryDto)) query: CampusQueryDto
  ): Promise<ReferenceListDto> {
    return this.locations.campuses(query)
  }

  @Get("locations")
  @ApiOperation({
    summary: "Найти точки маршрута",
    description:
      "Публичный справочник. q ищет по названию и адресу; districtId, campusId, kind, address объединяются через И.",
  })
  @ApiOkResponse({ type: LocationListDto })
  points(
    @Query(validation(LocationQueryDto)) query: LocationQueryDto
  ): Promise<LocationListDto> {
    return this.locations.locations(query)
  }
}
