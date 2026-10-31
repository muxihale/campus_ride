import { Transform } from "class-transformer"
import { ApiProperty, ApiPropertyOptional, PickType } from "@nestjs/swagger"
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsISO8601,
  IsOptional,
  Matches,
} from "class-validator"
import { NotificationKind } from "../generated/prisma/enums.js"
import { RideQueryDto } from "../rides/ride-query.dto.js"
export class NotificationsQueryDto extends PickType(RideQueryDto, [
  "q",
  "page",
  "pageSize",
] as const) {
  @ApiPropertyOptional({ enum: NotificationKind })
  @IsOptional()
  @IsEnum(NotificationKind)
  kind?: NotificationKind
  @ApiPropertyOptional({ type: Boolean })
  @Transform(({ value }: { value: unknown }) =>
    value === "true" ? true : value === "false" ? false : value
  )
  @IsOptional()
  @IsBoolean()
  read?: boolean
  @ApiPropertyOptional({ type: String, format: "date-time" })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/)
  dateFrom?: string
  @ApiPropertyOptional({ type: String, format: "date-time" })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/)
  dateTo?: string
  @ApiPropertyOptional({
    enum: ["booking", "ride", "payment", "review", "user"],
  })
  @IsOptional()
  @IsIn(["booking", "ride", "payment", "review", "user"])
  resourceType?: string
}
export class NotificationDto {
  @ApiProperty({ type: String, format: "uuid" })
  id!: string
  @ApiProperty({ enum: NotificationKind })
  kind!: NotificationKind
  @ApiProperty({ type: String })
  title!: string
  @ApiProperty({ type: String })
  body!: string
  @ApiProperty({ type: String, nullable: true })
  link!: string | null
  @ApiProperty({ type: String, nullable: true })
  resourceType!: string | null
  @ApiProperty({ type: String, nullable: true, format: "uuid" })
  resourceId!: string | null
  @ApiProperty({ type: String, nullable: true, format: "date-time" })
  readAt!: Date | null
  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date
}
export class NotificationsListDto {
  @ApiProperty({ type: [NotificationDto] })
  items!: NotificationDto[]
  @ApiProperty({ type: Number })
  total!: number
  @ApiProperty({ type: Number })
  page!: number
  @ApiProperty({ type: Number })
  pageSize!: number
}
export class ReadNotificationDto {}
