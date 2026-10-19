import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common"
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger"
import { PrismaService } from "../prisma/prisma.service.js"

class HealthResponse {
  @ApiProperty({ example: "ok" })
  status!: string

  @ApiProperty({ example: "campusride-api" })
  service!: string
}

class ReadinessResponse extends HealthResponse {
  @ApiProperty({ example: "connected" })
  database!: string
}

@ApiTags("Состояние сервиса")
@Controller("health")
export class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: "Проверить доступность API без обращения к БД" })
  @ApiOkResponse({ type: HealthResponse })
  health(): HealthResponse {
    return { status: "ok", service: "campusride-api" }
  }

  @Get("ready")
  @ApiOperation({ summary: "Проверить соединение API с PostgreSQL" })
  @ApiOkResponse({ type: ReadinessResponse })
  @ApiServiceUnavailableResponse({ description: "База данных недоступна" })
  async ready(): Promise<ReadinessResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`
      return { status: "ok", service: "campusride-api", database: "connected" }
    } catch {
      throw new ServiceUnavailableException("База данных недоступна")
    }
  }
}
