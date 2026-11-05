import { ActivityModule } from "./activity/activity.module.js"
import { AdminModule } from "./admin/admin.module.js"
import { ReviewsModule } from "./reviews/reviews.module.js"
import { NotificationsModule } from "./notifications/notifications.module.js"
import { BookingsModule } from "./bookings/bookings.module.js"
import { Module } from "@nestjs/common"
import { ConfigModule } from "@nestjs/config"
import { HealthController } from "./health/health.controller.js"
import { PrismaModule } from "./prisma/prisma.module.js"
import { RidesModule } from "./rides/rides.module.js"
import { LocationsModule } from "./locations/locations.module.js"
import { VehiclesModule } from "./vehicles/vehicles.module.js"
import { UsersModule } from "./users/users.module.js"
import { AuthModule } from "./auth/auth.module.js"

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
    AuthModule,
    UsersModule,
    VehiclesModule,
    LocationsModule,
    RidesModule,
    BookingsModule,
    NotificationsModule,
    ReviewsModule,
    AdminModule,
    ActivityModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
