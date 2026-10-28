import { Module } from "@nestjs/common"
import { AuthModule } from "../auth/auth.module.js"
import { TrustedOriginGuard } from "../auth/trusted-origin.guard.js"
import { PrismaModule } from "../prisma/prisma.module.js"
import { VehiclesController } from "./vehicles.controller.js"
import { VehiclesService } from "./vehicles.service.js"

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [VehiclesController],
  providers: [VehiclesService, TrustedOriginGuard],
})
export class VehiclesModule {}
