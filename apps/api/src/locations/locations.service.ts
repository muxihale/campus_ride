import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common"
import type { Prisma } from "../generated/prisma/client.js"
import { PrismaService } from "../prisma/prisma.service.js"
import type {
  CampusQueryDto,
  DistrictQueryDto,
  LocationListDto,
  LocationQueryDto,
  ReferenceListDto,
} from "./location.dto.js"

const referenceSelect = { id: true, name: true }
const contains = (value: string) => ({
  contains: value,
  mode: "insensitive" as const,
})

@Injectable()
export class LocationsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async locations(query: LocationQueryDto): Promise<LocationListDto> {
    const where: Prisma.LocationWhereInput = {
      districtId: query.districtId,
      campusId: query.campusId,
      kind: query.kind,
      ...(query.address ? { address: contains(query.address) } : {}),
      ...(query.q
        ? { OR: [{ name: contains(query.q) }, { address: contains(query.q) }] }
        : {}),
    }
    try {
      const [items, total] = await this.prisma.$transaction(
        [
          this.prisma.location.findMany({
            where,
            include: {
              district: { select: referenceSelect },
              campus: { select: referenceSelect },
            },
            orderBy: [{ name: "asc" }, { id: "asc" }],
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
          }),
          this.prisma.location.count({ where }),
        ],
        { isolationLevel: "RepeatableRead" }
      )
      return { items, total, page: query.page, pageSize: query.pageSize }
    } catch {
      throw new ServiceUnavailableException("Справочники временно недоступны")
    }
  }

  async districts(query: DistrictQueryDto): Promise<ReferenceListDto> {
    const points = this.referenceLocations(query)
    const where: Prisma.DistrictWhereInput = {
      ...(query.q ? { name: contains(query.q) } : {}),
      ...(Object.keys(points).length || query.campusId
        ? { locations: { some: { ...points, campusId: query.campusId } } }
        : {}),
    }
    try {
      const [items, total] = await this.prisma.$transaction(
        [
          this.prisma.district.findMany({
            where,
            select: referenceSelect,
            orderBy: [{ name: "asc" }, { id: "asc" }],
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
          }),
          this.prisma.district.count({ where }),
        ],
        { isolationLevel: "RepeatableRead" }
      )
      return { items, total, page: query.page, pageSize: query.pageSize }
    } catch {
      throw new ServiceUnavailableException("Справочники временно недоступны")
    }
  }

  async campuses(query: CampusQueryDto): Promise<ReferenceListDto> {
    const points = this.referenceLocations(query)
    const where: Prisma.CampusWhereInput = {
      ...(query.q ? { name: contains(query.q) } : {}),
      ...(Object.keys(points).length || query.districtId
        ? { locations: { some: { ...points, districtId: query.districtId } } }
        : {}),
    }
    try {
      const [items, total] = await this.prisma.$transaction(
        [
          this.prisma.campus.findMany({
            where,
            select: referenceSelect,
            orderBy: [{ name: "asc" }, { id: "asc" }],
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
          }),
          this.prisma.campus.count({ where }),
        ],
        { isolationLevel: "RepeatableRead" }
      )
      return { items, total, page: query.page, pageSize: query.pageSize }
    } catch {
      throw new ServiceUnavailableException("Справочники временно недоступны")
    }
  }

  private referenceLocations(
    query: CampusQueryDto | DistrictQueryDto
  ): Prisma.LocationWhereInput {
    return {
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.address ? { address: contains(query.address) } : {}),
      ...(query.locationName ? { name: contains(query.locationName) } : {}),
    }
  }
}
