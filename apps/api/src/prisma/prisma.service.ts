import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../generated/prisma/client.js"

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(ConfigService) config: ConfigService) {
    const adapter = new PrismaPg({
      connectionString: config.getOrThrow<string>("DATABASE_URL"),
      connectionTimeoutMillis: 3000,
      query_timeout: 3000,
    })
    super({ adapter })
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }
}
