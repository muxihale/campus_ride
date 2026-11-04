import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger"
import { Transform } from "class-transformer"
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from "class-validator"
import {
  ReviewsQueryDto,
  ReviewPersonDto,
} from "../reviews/review-query.dto.js"
import { ReviewDto } from "../reviews/review.dto.js"
import { BookingStatus, RideStatus } from "../generated/prisma/enums.js"
export class AdminReviewsQueryDto extends ReviewsQueryDto {
  @ApiPropertyOptional({ type: Boolean })
  @Transform(({ value }: { value: unknown }) =>
    value === "true" ? true : value === "false" ? false : value
  )
  @IsOptional()
  @IsBoolean()
  hidden?: boolean
  @ApiPropertyOptional({ type: String, format: "uuid" })
  @IsOptional()
  @IsUUID()
  authorId?: string
  @ApiPropertyOptional({ type: String, format: "uuid" })
  @IsOptional()
  @IsUUID()
  recipientId?: string
  @ApiPropertyOptional({ type: String, format: "uuid" })
  @IsOptional()
  @IsUUID()
  bookingId?: string
}
export class AdminReviewDto extends ReviewDto {
  @ApiProperty({ type: ReviewPersonDto }) author!: ReviewPersonDto
  @ApiProperty({ type: ReviewPersonDto }) recipient!: ReviewPersonDto
  @ApiProperty({ enum: ["DRIVER", "PASSENGER"], nullable: true })
  recipientRole!: "DRIVER" | "PASSENGER" | null
  @ApiProperty({ enum: BookingStatus }) bookingStatus!: BookingStatus
  @ApiProperty({ enum: RideStatus }) rideStatus!: RideStatus
  @ApiProperty({ type: String, nullable: true, format: "date-time" })
  hiddenAt!: Date | null
  @ApiProperty({ type: String, nullable: true }) hiddenReason!: string | null
}
export class AdminReviewsListDto {
  @ApiProperty({ type: [AdminReviewDto] }) items!: AdminReviewDto[]
  @ApiProperty({ type: Number }) total!: number
  @ApiProperty({ type: Number }) page!: number
  @ApiProperty({ type: Number }) pageSize!: number
}
export class ModerateReviewDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 500 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value
  )
  @IsString()
  @Length(1, 500)
  reason!: string
}
export class ReviewModerationResultDto {
  @ApiProperty({ type: String, format: "uuid" }) id!: string
  @ApiProperty({ type: Boolean }) changed!: boolean
  @ApiProperty({ type: String, nullable: true, format: "date-time" })
  hiddenAt!: Date | null
  @ApiProperty({ type: String, nullable: true }) hiddenReason!: string | null
}
