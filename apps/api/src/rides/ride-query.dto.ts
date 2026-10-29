import { Transform } from "class-transformer"
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger"
import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator"
import { RideStatus } from "../generated/prisma/enums.js"
import { RideDto } from "./ride.dto.js"
const integer = ({ value }: { value: unknown }) =>
  typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value
export class RideQueryDto {
  @ApiPropertyOptional({ type: String, maxLength: 100 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value
  )
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string
  @ApiPropertyOptional({ enum: RideStatus })
  @IsOptional()
  @IsEnum(RideStatus)
  status?: RideStatus
  @ApiPropertyOptional({ type: String, format: "uuid" })
  @IsOptional()
  @IsUUID()
  vehicleId?: string
  @ApiPropertyOptional({ type: String, format: "uuid" })
  @IsOptional()
  @IsUUID()
  originId?: string
  @ApiPropertyOptional({ type: String, format: "uuid" })
  @IsOptional()
  @IsUUID()
  destinationId?: string
  @ApiPropertyOptional({ type: Number, minimum: 0, maximum: 2147483647 })
  @Transform(integer)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  maxPriceKopecks?: number
  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: 8,
    description: "Предложенное число мест, не свободный остаток",
  })
  @Transform(integer)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  minSeats?: number
  @ApiPropertyOptional({
    type: String,
    format: "date-time",
    description: "Отправление от, включительно, с часовым поясом",
  })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/)
  departureFrom?: string
  @ApiPropertyOptional({
    type: String,
    format: "date-time",
    description: "Отправление до, включительно, с часовым поясом",
  })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/)
  departureTo?: string
  @ApiPropertyOptional({
    enum: ["departureAsc", "departureDesc", "createdDesc"],
    default: "departureAsc",
  })
  @IsIn(["departureAsc", "departureDesc", "createdDesc"])
  sort: "departureAsc" | "departureDesc" | "createdDesc" = "departureAsc"
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
export class RideListDto {
  @ApiProperty({ type: [RideDto] })
  items!: RideDto[]
  @ApiProperty({ type: Number })
  total!: number
  @ApiProperty({ type: Number })
  page!: number
  @ApiProperty({ type: Number })
  pageSize!: number
}
