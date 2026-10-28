import { Transform } from "class-transformer"
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator"
import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger"
import { CreateVehicleDto } from "../users/driver.dto.js"

export class UpdateVehicleDto extends PartialType(CreateVehicleDto, {
  skipNullProperties: false,
}) {}

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value
const integer = ({ value }: { value: unknown }) =>
  typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value

export class VehicleQueryDto {
  @ApiPropertyOptional({
    type: String,
    maxLength: 100,
    description: "Поиск по марке, модели, цвету и госномеру",
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string

  @ApiPropertyOptional({ type: String, maxLength: 60 })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  make?: string

  @ApiPropertyOptional({ type: String, maxLength: 60 })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  model?: string

  @ApiPropertyOptional({ type: String, maxLength: 40 })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  color?: string

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 8 })
  @Transform(integer)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  minSeats?: number

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 8 })
  @Transform(integer)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  maxSeats?: number

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

export class VehicleDto extends CreateVehicleDto {
  @ApiProperty({ type: String, format: "uuid" })
  id!: string

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date
}

export class VehicleListDto {
  @ApiProperty({ type: [VehicleDto] })
  items!: VehicleDto[]

  @ApiProperty({ type: Number })
  total!: number

  @ApiProperty({ type: Number })
  page!: number

  @ApiProperty({ type: Number })
  pageSize!: number
}
