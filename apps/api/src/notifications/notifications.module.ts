import { Module } from "@nestjs/common"
import { AuthModule } from "../auth/auth.module.js"
import { PrismaModule } from "../prisma/prisma.module.js"
import { TrustedOriginGuard } from "../auth/trusted-origin.guard.js"
import { NotificationsController } from "./notifications.controller.js"
import { NotificationsService } from "./notifications.service.js"
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, TrustedOriginGuard],
})
export class NotificationsModule {}
