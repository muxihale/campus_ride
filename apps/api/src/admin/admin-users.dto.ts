import { ApiProperty, ApiPropertyOptional, PickType } from "@nestjs/swagger"
import { Transform } from "class-transformer"
import {
  IsEnum,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator"
import { Role, UserStatus } from "../generated/prisma/enums.js"
import { RideQueryDto } from "../rides/ride-query.dto.js"
export class AdminUsersQueryDto extends PickType(RideQueryDto, [
  "q",
  "page",
  "pageSize",
] as const) {
  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role
  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus
  @ApiPropertyOptional({
    type: String,
    maxLength: 200,
    description: "Часть принадлежности к университету, без учёта регистра",
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value
  )
  @IsOptional()
  @IsString()
  @MaxLength(200)
  affiliation?: string
  @ApiPropertyOptional({ type: String, format: "date-time" })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/)
  registeredFrom?: string
  @ApiPropertyOptional({ type: String, format: "date-time" })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/)
  registeredTo?: string
  @ApiPropertyOptional({
    enum: ["createdDesc", "createdAsc", "nameAsc"],
    default: "createdDesc",
  })
  @IsIn(["createdDesc", "createdAsc", "nameAsc"])
  sort: "createdDesc" | "createdAsc" | "nameAsc" = "createdDesc"
}
export class AdminUserDto {
  @ApiProperty({ type: String, format: "uuid" }) id!: string
  @ApiProperty({ type: String }) email!: string
  @ApiProperty({ type: String }) fullName!: string
  @ApiProperty({ type: String, nullable: true }) affiliation!: string | null
  @ApiProperty({ enum: UserStatus }) status!: UserStatus
  @ApiProperty({ enum: Role, isArray: true }) roles!: Role[]
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: Date
  @ApiProperty({ type: String, format: "date-time" }) updatedAt!: Date
}
export class AdminUsersListDto {
  @ApiProperty({ type: [AdminUserDto] }) items!: AdminUserDto[]
  @ApiProperty({ type: Number }) total!: number
  @ApiProperty({ type: Number }) page!: number
  @ApiProperty({ type: Number }) pageSize!: number
}
