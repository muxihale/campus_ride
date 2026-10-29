import { Transform } from "class-transformer"
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator"
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger"
import { LocationKind } from "../generated/prisma/enums.js"

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value
const integer = ({ value }: { value: unknown }) =>
  typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value

export class ReferenceQueryDto {
  @ApiPropertyOptional({ type: String, maxLength: 100 })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string

  @ApiPropertyOptional({ enum: LocationKind })
  @IsOptional()
  @IsEnum(LocationKind)
  kind?: LocationKind

  @ApiPropertyOptional({
    type: String,
    maxLength: 200,
    description: "Подстрока адреса точки",
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string

  @ApiPropertyOptional({
    type: Number,
    default: 1,
    minimum: 1,
    maximum: 1000000,
  })
  @Transform(integer)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page = 1

  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @Transform(integer)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20
}

export class LocationQueryDto extends ReferenceQueryDto {
  @ApiPropertyOptional({ type: String, format: "uuid" })
  @IsOptional()
  @IsUUID()
  districtId?: string

  @ApiPropertyOptional({ type: String, format: "uuid" })
  @IsOptional()
  @IsUUID()
  campusId?: string
}

export class DistrictQueryDto extends ReferenceQueryDto {
  @ApiPropertyOptional({
    type: String,
    maxLength: 100,
    description: "Подстрока названия точки",
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  locationName?: string

  @ApiPropertyOptional({ type: String, format: "uuid" })
  @IsOptional()
  @IsUUID()
  campusId?: string
}

export class CampusQueryDto extends ReferenceQueryDto {
  @ApiPropertyOptional({
    type: String,
    maxLength: 100,
    description: "Подстрока названия точки",
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  locationName?: string

  @ApiPropertyOptional({ type: String, format: "uuid" })
  @IsOptional()
  @IsUUID()
  districtId?: string
}

export class ReferenceDto {
  @ApiProperty({ type: String, format: "uuid" })
  id!: string

  @ApiProperty({ type: String })
  name!: string
}

export class LocationDto extends ReferenceDto {
  @ApiProperty({ type: String })
  address!: string

  @ApiProperty({ enum: LocationKind })
  kind!: LocationKind

  @ApiProperty({ type: String, format: "uuid" })
  districtId!: string

  @ApiProperty({ type: String, format: "uuid", nullable: true })
  campusId!: string | null

  @ApiProperty({ type: ReferenceDto })
  district!: ReferenceDto

  @ApiProperty({ type: ReferenceDto, nullable: true })
  campus!: ReferenceDto | null
}

export class ReferenceListDto {
  @ApiProperty({ type: [ReferenceDto] })
  items!: ReferenceDto[]
  @ApiProperty({ type: Number })
  total!: number
  @ApiProperty({ type: Number })
  page!: number
  @ApiProperty({ type: Number })
  pageSize!: number
}

export class LocationListDto {
  @ApiProperty({ type: [LocationDto] })
  items!: LocationDto[]
  @ApiProperty({ type: Number })
  total!: number
  @ApiProperty({ type: Number })
  page!: number
  @ApiProperty({ type: Number })
  pageSize!: number
}
