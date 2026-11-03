import { AuthModule } from "../auth/auth.module.js"
import { PrismaModule } from "../prisma/prisma.module.js"
import { TrustedOriginGuard } from "../auth/trusted-origin.guard.js"
import { Module } from "@nestjs/common"
import { ReviewsController } from "./reviews.controller.js"
import { ReviewsService } from "./reviews.service.js"
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ReviewsController],
  providers: [ReviewsService, TrustedOriginGuard],
})
export class ReviewsModule {}
