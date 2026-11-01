import { DriverBookingsController } from "./driver-bookings.controller.js"
import { DriverBookingsService } from "./driver-bookings.service.js"
import { OwnBookingsController } from "./own-bookings.controller.js"
import { OwnBookingsService } from "./own-bookings.service.js"
import { BookingDecisionsController } from "./booking-decisions.controller.js"
import { Module } from "@nestjs/common"
import { AuthModule } from "../auth/auth.module.js"
import { TrustedOriginGuard } from "../auth/trusted-origin.guard.js"
import { PrismaModule } from "../prisma/prisma.module.js"
import {
  BookingCancellationController,
  BookingsController,
} from "./bookings.controller.js"
import { BookingsService } from "./bookings.service.js"
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [
    BookingsController,
    BookingCancellationController,
    BookingDecisionsController,
    OwnBookingsController,
    DriverBookingsController,
  ],
  providers: [
    BookingsService,
    OwnBookingsService,
    DriverBookingsService,
    TrustedOriginGuard,
  ],
})
export class BookingsModule {}
