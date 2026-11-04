import {
  AdminActivityController,
  AdminActivityService,
} from "./admin-activity.js"
import { AdminReviewsController } from "./admin-reviews.controller.js"
import { AdminReviewsService } from "./admin-reviews.service.js"
import { UserStatusController } from "./user-status.controller.js"
import { UserStatusService } from "./user-status.service.js"
import { TrustedOriginGuard } from "../auth/trusted-origin.guard.js"
import { Module } from "@nestjs/common"
import { AuthModule } from "../auth/auth.module.js"
import { PrismaModule } from "../prisma/prisma.module.js"
import { AdminUsersController } from "./admin-users.controller.js"
import { AdminUsersService } from "./admin-users.service.js"
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [
    AdminUsersController,
    UserStatusController,
    AdminReviewsController,
    AdminActivityController,
  ],
  providers: [
    AdminUsersService,
    UserStatusService,
    AdminReviewsService,
    AdminActivityService,
    TrustedOriginGuard,
  ],
})
export class AdminModule {}
