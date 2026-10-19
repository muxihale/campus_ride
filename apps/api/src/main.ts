import "reflect-metadata"
import { Logger } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { NestFactory } from "@nestjs/core"
import { AppModule } from "./app.module.js"
import { configureApp } from "./setup.js"

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  configureApp(app)
  app.enableShutdownHooks()
  const port = app.get(ConfigService).getOrThrow<number>("API_PORT")
  await app.listen(port, "0.0.0.0")
  Logger.log(`CampusRide API: http://localhost:${port}/api/docs`, "Bootstrap")
}

void bootstrap().catch((error: unknown) => {
  Logger.error(error, undefined, "Bootstrap")
  process.exitCode = 1
})
