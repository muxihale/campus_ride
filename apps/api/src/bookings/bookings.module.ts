import { Module } from "@nestjs/common"
import { AuthModule } from "../auth/auth.module.js"
import { TrustedOriginGuard } from "../auth/trusted-origin.guard.js"
import { PrismaModule } from "../prisma/prisma.module.js"
import { BookingsController } from "./bookings.controller.js"
import { BookingsService } from "./bookings.service.js"
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [BookingsController],
  providers: [BookingsService, TrustedOriginGuard],
})
export class BookingsModule {}
