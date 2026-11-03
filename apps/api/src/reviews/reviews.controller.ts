import {
  Body,
  Controller,
  Header,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common"
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger"
import { SESSION_COOKIE } from "../auth/auth.service.js"
import { Roles } from "../auth/roles.decorator.js"
import type { SessionRequest } from "../auth/session.guard.js"
import { TrustedOriginGuard } from "../auth/trusted-origin.guard.js"
import { CreateReviewDto, ReviewDto } from "./review.dto.js"
import { ReviewsService } from "./reviews.service.js"

@ApiTags("Отзывы")
@ApiCookieAuth(SESSION_COOKIE)
@Roles("PASSENGER", "DRIVER")
@Controller("bookings/:id/reviews")
export class ReviewsController {
  constructor(
    @Inject(ReviewsService) private readonly reviews: ReviewsService
  ) {}
  @Post()
  @UseGuards(TrustedOriginGuard)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Оставить отзыв второму участнику завершённой поездки",
    description:
      "Пассажир оценивает водителя, водитель — пассажира. Автор и получатель назначаются сервером. Один отзыв от автора на заявку; повтор, включая тот же текст, возвращает 409. Отзыв, уведомление получателю и запись журнала сохраняются атомарно.",
  })
  @ApiHeader({ name: "Origin", required: true })
  @ApiBody({ type: CreateReviewDto })
  @ApiCreatedResponse({ type: ReviewDto })
  @ApiBadRequestResponse({
    description: "Неверный UUID, оценка, комментарий или лишние поля",
  })
  @ApiUnauthorizedResponse({ description: "Нет действующей сессии" })
  @ApiForbiddenResponse({
    description: "Нет требуемой роли или неверный Origin",
  })
  @ApiNotFoundResponse({ description: "Чужая либо отсутствующая заявка" })
  @ApiConflictResponse({
    description:
      "Поездка/заявка не завершена, некорректное время, самооценка или повторный отзыв",
  })
  @ApiResponse({
    status: 503,
    description: "Создание отзыва временно недоступно",
  })
  create(
    @Req() request: SessionRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(
      new ValidationPipe({
        expectedType: CreateReviewDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    )
    input: CreateReviewDto
  ): Promise<ReviewDto> {
    return this.reviews.create(
      request.currentUser.id,
      request.currentUser.roles,
      id,
      input
    )
  }
}
