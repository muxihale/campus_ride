import { ValidationPipe, type INestApplication } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger"
import cookieParser from "cookie-parser"
import { SESSION_COOKIE } from "./auth/auth.service.js"

export function configureApp(app: INestApplication) {
  app.setGlobalPrefix("api")
  app.use(cookieParser())
  app.enableCors({
    origin: app.get(ConfigService).getOrThrow<string>("WEB_ORIGIN"),
    credentials: true,
  })
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })
  )
  const config = new DocumentBuilder()
    .setTitle("CampusRide API")
    .setDescription(
      "API учебного сервиса совместных поездок в УрФУ. Реализованы проверки состояния, регистрация пассажира, вход, выход и текущий пользователь."
    )
    .setVersion("0.1.0")
    .addCookieAuth(
      SESSION_COOKIE,
      { type: "apiKey", in: "cookie" },
      SESSION_COOKIE
    )
    .build()
  SwaggerModule.setup("api/docs", app, () =>
    SwaggerModule.createDocument(app, config)
  )
}
