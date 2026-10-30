import { Transform } from "class-transformer"
import { ApiProperty, ApiPropertyOptional, OmitType } from "@nestjs/swagger"
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
} from "class-validator"
import { RideQueryDto } from "./ride-query.dto.js"

const boolean = ({ value }: { value: unknown }) =>
  value === "true" ? true : value === "false" ? false : value
export class PublicSearchDto extends OmitType(RideQueryDto, [
  "status",
  "vehicleId",
  "originId",
  "destinationId",
  "departureFrom",
  "departureTo",
  "sort",
] as const) {
  @ApiPropertyOptional({ enum: ["TO_CAMPUS", "FROM_CAMPUS"] })
  @IsOptional()
  @IsIn(["TO_CAMPUS", "FROM_CAMPUS"])
  direction?: "TO_CAMPUS" | "FROM_CAMPUS"
  @ApiPropertyOptional({ type: String, format: "uuid" })
  @IsOptional()
  @IsUUID()
  originDistrictId?: string
  @ApiPropertyOptional({ type: String, format: "uuid" })
  @IsOptional()
  @IsUUID()
  campusId?: string
  @ApiPropertyOptional({
    type: String,
    example: "2026-11-09",
    description: "Календарная дата Екатеринбурга",
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string
  @ApiPropertyOptional({
    type: String,
    example: "08:00",
    description: "От включительно; требуется date",
  })
  @IsOptional()
  @Matches(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/)
  timeFrom?: string
  @ApiPropertyOptional({
    type: String,
    example: "09:00",
    description: "До конца указанной минуты; требуется date",
  })
  @IsOptional()
  @Matches(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/)
  timeTo?: string
  @ApiPropertyOptional({ type: Boolean })
  @Transform(boolean)
  @IsOptional()
  @IsBoolean()
  musicAllowed?: boolean
  @ApiPropertyOptional({ type: Boolean })
  @Transform(boolean)
  @IsOptional()
  @IsBoolean()
  luggageAllowed?: boolean
  @ApiPropertyOptional({ type: Boolean })
  @Transform(boolean)
  @IsOptional()
  @IsBoolean()
  smokingAllowed?: boolean
  @ApiPropertyOptional({
    enum: ["departureAsc", "departureDesc", "priceAsc", "priceDesc"],
    default: "departureAsc",
  })
  @IsIn(["departureAsc", "departureDesc", "priceAsc", "priceDesc"])
  sort: "departureAsc" | "departureDesc" | "priceAsc" | "priceDesc" =
    "departureAsc"
}
export class PublicPointDto {
  @ApiProperty({ type: String, format: "uuid" })
  id!: string
  @ApiProperty({ type: String })
  name!: string
  @ApiProperty({ type: String })
  address!: string
}
export class PublicDriverDto {
  @ApiProperty({ type: String, format: "uuid" })
  id!: string
  @ApiProperty({ type: String })
  fullName!: string
}
export class PublicVehicleDto {
  @ApiProperty({ type: String })
  make!: string
  @ApiProperty({ type: String })
  model!: string
  @ApiProperty({ type: String })
  color!: string
}
export class PublicRideDto {
  @ApiProperty({ type: String, format: "uuid" })
  id!: string
  @ApiProperty({ type: PublicPointDto })
  origin!: PublicPointDto
  @ApiProperty({ type: PublicPointDto })
  destination!: PublicPointDto
  @ApiProperty({ type: String, format: "date-time" })
  departureAt!: Date
  @ApiProperty({
    type: Number,
    description:
      "Предложено мест; остаток по бронированиям добавляется на этапе 30.2",
  })
  seatsTotal!: number
  @ApiProperty({ type: Number })
  priceKopecks!: number
  @ApiProperty({ type: Boolean })
  musicAllowed!: boolean
  @ApiProperty({ type: Boolean })
  luggageAllowed!: boolean
  @ApiProperty({ type: Boolean })
  smokingAllowed!: boolean
  @ApiProperty({ type: String, nullable: true })
  conditions!: string | null
  @ApiProperty({ type: PublicDriverDto })
  driver!: PublicDriverDto
  @ApiProperty({ type: PublicVehicleDto })
  vehicle!: PublicVehicleDto
}
export class PublicRideListDto {
  @ApiProperty({ type: [PublicRideDto] })
  items!: PublicRideDto[]
  @ApiProperty({ type: Number })
  total!: number
  @ApiProperty({ type: Number })
  page!: number
  @ApiProperty({ type: Number })
  pageSize!: number
}
