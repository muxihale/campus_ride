import { Module } from "@nestjs/common"
import { ThrottlerModule } from "@nestjs/throttler"
import { PrismaModule } from "../prisma/prisma.module.js"
import { AuthController } from "./auth.controller.js"
import { AuthService } from "./auth.service.js"
import { SessionGuard } from "./session.guard.js"
import { TrustedOriginGuard } from "./trusted-origin.guard.js"

@Module({
  imports: [
    PrismaModule,
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 10 }],
      errorMessage: "Слишком много попыток авторизации. Повторите позже",
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionGuard, TrustedOriginGuard],
  exports: [SessionGuard, AuthService],
})
export class AuthModule {}
