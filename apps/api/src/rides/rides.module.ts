import { Module } from "@nestjs/common"
import { AuthModule } from "../auth/auth.module.js"
import { TrustedOriginGuard } from "../auth/trusted-origin.guard.js"
import { PrismaModule } from "../prisma/prisma.module.js"
import { PublicSearchController } from "./public-search.controller.js"
import { PublicSearchService } from "./public-search.service.js"
import { OwnRidesController } from "./own-rides.controller.js"
import { RidesController } from "./rides.controller.js"
import { RidesService } from "./rides.service.js"

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [RidesController, OwnRidesController, PublicSearchController],
  providers: [RidesService, PublicSearchService, TrustedOriginGuard],
})
export class RidesModule {}
