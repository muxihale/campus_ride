import {
  ForbiddenException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import type { Request } from "express"

@Injectable()
export class TrustedOriginGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>()
    // Проверка не использует Host/X-Forwarded-Host, переданные клиентом.
    if (
      request.headers.origin !== this.config.getOrThrow<string>("WEB_ORIGIN")
    ) {
      throw new ForbiddenException("Источник запроса не разрешён")
    }
    return true
  }
}
