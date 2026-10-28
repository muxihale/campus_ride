import { Module } from "@nestjs/common"
import { AuthModule } from "../auth/auth.module.js"
import { TrustedOriginGuard } from "../auth/trusted-origin.guard.js"
import { PrismaModule } from "../prisma/prisma.module.js"
import { UsersController } from "./users.controller.js"
import { UsersService } from "./users.service.js"

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [UsersController],
  providers: [UsersService, TrustedOriginGuard],
})
export class UsersModule {}
