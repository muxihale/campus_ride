import { applyDecorators, SetMetadata, UseGuards } from "@nestjs/common"
import type { Role } from "../generated/prisma/enums.js"
import { SessionGuard } from "./session.guard.js"
import { REQUIRED_ROLES, RolesGuard } from "./roles.guard.js"

// Достаточно одной из перечисленных ролей. Сессия проверяется первой.
export function Roles(...roles: [Role, ...Role[]]) {
  return applyDecorators(
    SetMetadata(REQUIRED_ROLES, roles),
    UseGuards(SessionGuard, RolesGuard)
  )
}
