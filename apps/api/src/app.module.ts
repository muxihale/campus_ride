import { Module } from "@nestjs/common"
import { ConfigModule } from "@nestjs/config"
import { HealthController } from "./health/health.controller.js"
import { PrismaModule } from "./prisma/prisma.module.js"

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", "../../.env"],
      validate: (env: Record<string, unknown>) => {
        const port = Number(env.API_PORT ?? 3001)
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new Error("API_PORT должен быть целым числом от 1 до 65535")
        }
        return {
          ...env,
          API_PORT: port,
          WEB_ORIGIN: env.WEB_ORIGIN ?? "http://localhost:5173",
        }
      },
    }),
    PrismaModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
