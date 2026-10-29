import { Transform, Type } from "class-transformer"
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
  ValidateIf,
} from "class-validator"
import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from "@nestjs/swagger"
import { RideStatus } from "../generated/prisma/enums.js"

export class RideStopInputDto {
  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  locationId!: string
}

export class CreateRideDto {
  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  vehicleId!: string

  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  originId!: string

  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  destinationId!: string

  @ApiProperty({
    type: String,
    format: "date-time",
    example: "2026-11-09T08:00:00+05:00",
    description: "Будущее время с явным часовым поясом",
  })
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/, {
    message:
      "Укажите дату и время с часовым поясом, например 2026-11-09T08:00:00+05:00",
  })
  departureAt!: string

  @ApiProperty({ type: Number, minimum: 1, maximum: 8 })
  @IsInt()
  @Min(1)
  @Max(8)
  seatsTotal!: number

  @ApiProperty({
    type: Number,
    minimum: 0,
    maximum: 2147483647,
    description: "Цена за одно место в целых копейках; 0 — бесплатно",
  })
  @IsInt()
  @Min(0)
  @Max(2147483647)
  priceKopecks!: number

  @ApiProperty({ type: Boolean, default: true })
  @IsBoolean()
  musicAllowed = true

  @ApiProperty({ type: Boolean, default: false })
  @IsBoolean()
  luggageAllowed = false

  @ApiProperty({ type: Boolean, default: false })
  @IsBoolean()
  smokingAllowed = false

  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: 1000,
    example: "Встречаемся у главного входа. Есть место для рюкзака.",
    description: "Условия и уточнение места встречи",
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value
  )
  @IsString()
  @Length(1, 1000)
  conditions!: string

  @ApiProperty({
    type: [RideStopInputDto],
    default: [],
    maxItems: 10,
    description: "Остановки в порядке посещения, без повторов и конечных точек",
  })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => RideStopInputDto)
  stops: RideStopInputDto[] = []
}

export class RideStopDto extends RideStopInputDto {
  @ApiProperty({ type: String, format: "uuid" })
  id!: string
  @ApiProperty({ type: Number, minimum: 1 })
  position!: number
}

export class RideDto extends OmitType(CreateRideDto, ["stops"] as const) {
  @ApiProperty({ type: String, format: "uuid" })
  id!: string
  @ApiProperty({ type: String, format: "uuid" })
  driverId!: string
  @ApiProperty({ enum: RideStatus })
  status!: RideStatus
  @ApiProperty({ type: [RideStopDto] })
  stops!: RideStopDto[]
  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: string
  @ApiProperty({ type: String, format: "date-time" })
  updatedAt!: string
}

// У частичного обновления нет значений по умолчанию: пропущенные настройки сохраняются.
export class UpdateRideDto extends PartialType(
  OmitType(CreateRideDto, [
    "musicAllowed",
    "luggageAllowed",
    "smokingAllowed",
    "stops",
  ] as const),
  { skipNullProperties: false }
) {
  @ApiPropertyOptional({ type: Boolean })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  musicAllowed?: boolean
  @ApiPropertyOptional({ type: Boolean })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  luggageAllowed?: boolean
  @ApiPropertyOptional({ type: Boolean })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  smokingAllowed?: boolean
  @ApiPropertyOptional({ type: [RideStopInputDto], maxItems: 10 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => RideStopInputDto)
  stops?: RideStopInputDto[]
}
