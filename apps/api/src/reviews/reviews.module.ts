import {
  OwnReviewsController,
  PublicReviewsController,
} from "./review-list.controller.js"
import { ReviewListService } from "./review-list.service.js"
import { AuthModule } from "../auth/auth.module.js"
import { PrismaModule } from "../prisma/prisma.module.js"
import { TrustedOriginGuard } from "../auth/trusted-origin.guard.js"
import { Module } from "@nestjs/common"
import { ReviewsController } from "./reviews.controller.js"
import { ReviewsService } from "./reviews.service.js"
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [
    ReviewsController,
    OwnReviewsController,
    PublicReviewsController,
  ],
  providers: [ReviewsService, ReviewListService, TrustedOriginGuard],
})
export class ReviewsModule {}
