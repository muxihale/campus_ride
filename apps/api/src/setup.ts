import { ValidationPipe, type INestApplication } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger"

export function configureApp(app: INestApplication) {
  app.setGlobalPrefix("api")
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
      "API учебного сервиса совместных поездок в УрФУ. Сейчас реализованы только проверки состояния."
    )
    .setVersion("0.1.0")
    .build()
  SwaggerModule.setup("api/docs", app, () =>
    SwaggerModule.createDocument(app, config)
  )
}
