import { RideCompletionController } from "./ride-completion.controller.js"
import { RideCompletionService } from "./ride-completion.service.js"
import { RideStartController } from "./ride-start.controller.js"
import { RideStartService } from "./ride-start.service.js"
import { RideCancellationController } from "./ride-cancellation.controller.js"
import { RideCancellationService } from "./ride-cancellation.service.js"
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
  controllers: [
    RidesController,
    OwnRidesController,
    PublicSearchController,
    RideCancellationController,
    RideStartController,
    RideCompletionController,
  ],
  providers: [
    RidesService,
    PublicSearchService,
    RideCancellationService,
    RideStartService,
    RideCompletionService,
    TrustedOriginGuard,
  ],
})
export class RidesModule {}
