import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
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
import { TrustedOriginGuard } from "../auth/trusted-origin.guard.js"
import { AdminReviewsService } from "./admin-reviews.service.js"
import {
  AdminReviewsListDto,
  AdminReviewsQueryDto,
  ModerateReviewDto,
  ReviewModerationResultDto,
} from "./admin-reviews.dto.js"
const bodyPipe = () =>
  new ValidationPipe({
    expectedType: ModerateReviewDto,
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  })
@ApiTags("Администрирование: отзывы")
@ApiCookieAuth(SESSION_COOKIE)
@Roles("ADMIN")
@ApiBadRequestResponse({
  description: "Неверные UUID, параметры, диапазоны или причина",
})
@ApiUnauthorizedResponse({ description: "Нет действующей сессии" })
@ApiForbiddenResponse({ description: "Нет ADMIN или неверный Origin" })
@ApiResponse({
  status: 503,
  description: "Модерация отзывов временно недоступна",
})
@Controller("admin/reviews")
export class AdminReviewsController {
  constructor(
    @Inject(AdminReviewsService) private readonly reviews: AdminReviewsService
  ) {}
  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Найти отзывы для модерации",
    description:
      "Включает скрытые отзывы. Поиск по тексту, причине и именам; фильтры видимости, роли получателя, оценки, дат, автора, получателя и заявки. Все условия объединяются через И. Данные контактов и сессий не выдаются.",
  })
  @ApiOkResponse({ type: AdminReviewsListDto })
  list(
    @Query(
      new ValidationPipe({
        expectedType: AdminReviewsQueryDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    )
    query: AdminReviewsQueryDto
  ): Promise<AdminReviewsListDto> {
    return this.reviews.list(query)
  }
  @Post(":id/hide")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @UseGuards(TrustedOriginGuard)
  @ApiHeader({ name: "Origin", required: true })
  @ApiBody({ type: ModerateReviewDto })
  @ApiOkResponse({ type: ReviewModerationResultDto })
  @ApiNotFoundResponse({ description: "Отзыв отсутствует" })
  @ApiOperation({
    summary: "Скрыть отзыв с причиной",
    description:
      "Атомарно сохраняет скрытие, аудит и уведомления. Скрытый отзыв исключается из списков и рейтингов. Повтор не меняет время и причину, не создаёт новых записей.",
  })
  hide(
    @Req() request: SessionRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(bodyPipe()) input: ModerateReviewDto
  ): Promise<ReviewModerationResultDto> {
    return this.reviews.moderate(request.currentUser.id, id, true, input.reason)
  }
  @Post(":id/restore")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @UseGuards(TrustedOriginGuard)
  @ApiHeader({ name: "Origin", required: true })
  @ApiBody({ type: ModerateReviewDto })
  @ApiOkResponse({ type: ReviewModerationResultDto })
  @ApiNotFoundResponse({ description: "Отзыв отсутствует" })
  @ApiOperation({
    summary: "Восстановить отзыв с причиной",
    description:
      "Очищает hiddenAt/hiddenReason; причина восстановления сохраняется в аудите и уведомлениях. Отзыв снова учитывается, если участие завершено и корректно. Повтор видимого отзыва не создаёт записей.",
  })
  restore(
    @Req() request: SessionRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(bodyPipe()) input: ModerateReviewDto
  ): Promise<ReviewModerationResultDto> {
    return this.reviews.moderate(
      request.currentUser.id,
      id,
      false,
      input.reason
    )
  }
}
