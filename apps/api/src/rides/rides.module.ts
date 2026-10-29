import { Module } from "@nestjs/common"
import { AuthModule } from "../auth/auth.module.js"
import { TrustedOriginGuard } from "../auth/trusted-origin.guard.js"
import { PrismaModule } from "../prisma/prisma.module.js"
import { RidesController } from "./rides.controller.js"
import { RidesService } from "./rides.service.js"

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [RidesController],
  providers: [RidesService, TrustedOriginGuard],
})
export class RidesModule {}
