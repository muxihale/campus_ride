import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common"
import type { Prisma } from "../generated/prisma/client.js"
import { PrismaService } from "../prisma/prisma.service.js"
import type {
  AdminUsersListDto,
  AdminUsersQueryDto,
} from "./admin-users.dto.js"
const select = {
  id: true,
  email: true,
  fullName: true,
  affiliation: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  roles: { select: { role: true }, orderBy: { role: "asc" } },
} satisfies Prisma.UserSelect
const literal = (value: string) => value.replace(/[\\%_]/g, "\\$&")
@Injectable()
export class AdminUsersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async list(query: AdminUsersQueryDto): Promise<AdminUsersListDto> {
    const from = query.registeredFrom
      ? new Date(query.registeredFrom)
      : undefined
    const to = query.registeredTo ? new Date(query.registeredTo) : undefined
    if (from && to && from > to)
      throw new BadRequestException("Начало диапазона регистрации позже конца")
    const text = query.q
      ? { contains: literal(query.q), mode: "insensitive" as const }
      : undefined
    const where: Prisma.UserWhereInput = {
      status: query.status,
      roles: query.role ? { some: { role: query.role } } : undefined,
      createdAt: { gte: from, lte: to },
      affiliation: query.affiliation
        ? { contains: literal(query.affiliation), mode: "insensitive" }
        : undefined,
      ...(text ? { OR: [{ fullName: text }, { email: text }] } : {}),
    }
    const orderBy: Prisma.UserOrderByWithRelationInput[] =
      query.sort === "nameAsc"
        ? [{ fullName: "asc" }, { id: "asc" }]
        : [
            { createdAt: query.sort === "createdAsc" ? "asc" : "desc" },
            { id: "asc" },
          ]
    try {
      const [items, total] = await this.prisma.$transaction(
        [
          this.prisma.user.findMany({
            where,
            select,
            orderBy,
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
          }),
          this.prisma.user.count({ where }),
        ],
        { isolationLevel: "RepeatableRead" }
      )
      return {
        items: items.map((item) => ({
          ...item,
          roles: item.roles.map((entry) => entry.role),
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      }
    } catch (error) {
      if (error instanceof HttpException) throw error
      throw new ServiceUnavailableException(
        "Список пользователей временно недоступен"
      )
    }
  }
}
