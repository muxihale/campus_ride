import { Module } from "@nestjs/common"
import { AuthModule } from "../auth/auth.module.js"
import { PrismaModule } from "../prisma/prisma.module.js"
import { ActivityController } from "./activity.controller.js"
import { ActivityService } from "./activity.service.js"
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ActivityController],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
