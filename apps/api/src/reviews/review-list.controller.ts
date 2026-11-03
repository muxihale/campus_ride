import {
  Controller,
  Get,
  Header,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  ValidationPipe,
} from "@nestjs/common"
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger"
import { Roles } from "../auth/roles.decorator.js"
import { SESSION_COOKIE } from "../auth/auth.service.js"
import type { SessionRequest } from "../auth/session.guard.js"
import { ReviewListService } from "./review-list.service.js"
import {
  OwnReviewsListDto,
  OwnReviewsQueryDto,
  PublicReviewsListDto,
  ReviewsQueryDto,
  UserRatingsDto,
} from "./review-query.dto.js"
const pipe = (expectedType: typeof ReviewsQueryDto) =>
  new ValidationPipe({
    expectedType,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  })
@ApiTags("Отзывы")
@ApiBadRequestResponse({ description: "Неверные параметры или диапазоны" })
@ApiResponse({ status: 503, description: "Отзывы временно недоступны" })
@Controller("me/reviews")
@Roles("PASSENGER", "DRIVER", "ADMIN")
@ApiCookieAuth(SESSION_COOKIE)
export class OwnReviewsController {
  constructor(
    @Inject(ReviewListService) private readonly reviews: ReviewListService
  ) {}
  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Найти свои полученные или оставленные отзывы",
    description:
      "direction=received/sent; скрытые отзывы исключены. q ищет по комментарию и именам участников. Фильтры объединяются через И; recipientRole — роль получателя в поездке.",
  })
  @ApiOkResponse({ type: OwnReviewsListDto })
  @ApiUnauthorizedResponse({ description: "Нет сессии" })
  @ApiForbiddenResponse({ description: "Нет разрешённой роли" })
  list(
    @Req() request: SessionRequest,
    @Query(pipe(OwnReviewsQueryDto)) query: OwnReviewsQueryDto
  ): Promise<OwnReviewsListDto> {
    return this.reviews.list(
      request.currentUser.id,
      query,
      true
    ) as Promise<OwnReviewsListDto>
  }
}
@ApiTags("Отзывы")
@ApiBadRequestResponse({
  description: "Неверный UUID, параметры или диапазоны",
})
@ApiNotFoundResponse({
  description: "Пользователь отсутствует или заблокирован",
})
@ApiResponse({ status: 503, description: "Отзывы временно недоступны" })
@Controller("users/:id")
export class PublicReviewsController {
  constructor(
    @Inject(ReviewListService) private readonly reviews: ReviewListService
  ) {}
  @Get("reviews")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Публичные полученные отзывы активного пользователя",
    description:
      "Без сессии. Только нескрытые отзывы завершённых участий. Контакты, bookingId и поля модерации не выдаются.",
  })
  @ApiOkResponse({ type: PublicReviewsListDto })
  list(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(pipe(ReviewsQueryDto)) query: ReviewsQueryDto
  ): Promise<PublicReviewsListDto> {
    return this.reviews.list(id, query)
  }
  @Get("ratings")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Раздельные рейтинги пользователя как водителя и пассажира",
    description:
      "Среднее до двух знаков и число нескрытых отзывов завершённых участий. Без оценок: average=null, count=0. Фильтры списка не влияют на рейтинг.",
  })
  @ApiOkResponse({ type: UserRatingsDto })
  ratings(
    @Param("id", new ParseUUIDPipe()) id: string
  ): Promise<UserRatingsDto> {
    return this.reviews.ratings(id)
  }
}
