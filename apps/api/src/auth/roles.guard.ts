import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common"
import { Reflector } from "@nestjs/core"
import type { Role } from "../generated/prisma/enums.js"
import type { SessionRequest } from "./session.guard.js"

export const REQUIRED_ROLES = "campusride:required-roles"

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<SessionRequest>().currentUser
    if (!user) throw new UnauthorizedException("Требуется вход в аккаунт")
    const roles = this.reflector.getAllAndOverride<Role[]>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!roles?.length || !roles.some((role) => user.roles.includes(role))) {
      throw new ForbiddenException("Недостаточно прав")
    }
    return true
  }
}
