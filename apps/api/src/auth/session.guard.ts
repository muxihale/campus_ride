import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common"
import type { Request } from "express"
import type { CurrentUserDto } from "./auth.dto.js"
import { AuthService, SESSION_COOKIE } from "./auth.service.js"

export interface SessionRequest extends Request {
  currentUser: CurrentUserDto
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SessionRequest>()
    request.currentUser = await this.auth.currentUser(
      request.cookies?.[SESSION_COOKIE]
    )
    return true
  }
}
