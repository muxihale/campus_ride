import { ApiProperty, ApiPropertyOptional, PickType } from "@nestjs/swagger"
import { Transform } from "class-transformer"
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  Matches,
  Max,
  Min,
} from "class-validator"
import { RideQueryDto } from "../rides/ride-query.dto.js"
import { ReviewDto } from "./review.dto.js"
const integer = ({ value }: { value: unknown }) =>
  typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value
export class ReviewsQueryDto extends PickType(RideQueryDto, [
  "q",
  "page",
  "pageSize",
] as const) {
  @ApiPropertyOptional({ enum: ["DRIVER", "PASSENGER"] })
  @IsOptional()
  @IsIn(["DRIVER", "PASSENGER"])
  recipientRole?: "DRIVER" | "PASSENGER"
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 5 })
  @Transform(integer)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  ratingMin?: number
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 5 })
  @Transform(integer)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  ratingMax?: number
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
  @ApiPropertyOptional({ enum: ["newest", "oldest"], default: "newest" })
  @IsIn(["newest", "oldest"])
  sort: "newest" | "oldest" = "newest"
}
export class OwnReviewsQueryDto extends ReviewsQueryDto {
  @ApiPropertyOptional({ enum: ["received", "sent"], default: "received" })
  @IsIn(["received", "sent"])
  direction: "received" | "sent" = "received"
}
export class ReviewPersonDto {
  @ApiProperty({ type: String, format: "uuid" }) id!: string
  @ApiProperty({ type: String }) fullName!: string
}
export class PublicReviewDto extends PickType(ReviewDto, [
  "id",
  "rating",
  "comment",
  "createdAt",
] as const) {
  @ApiProperty({ type: ReviewPersonDto }) author!: ReviewPersonDto
  @ApiProperty({ type: ReviewPersonDto }) recipient!: ReviewPersonDto
  @ApiProperty({ enum: ["DRIVER", "PASSENGER"] }) recipientRole!:
    "DRIVER" | "PASSENGER"
}
export class OwnReviewDto extends PublicReviewDto {
  @ApiProperty({ type: String, format: "uuid" }) bookingId!: string
}
export class PublicReviewsListDto {
  @ApiProperty({ type: [PublicReviewDto] }) items!: PublicReviewDto[]
  @ApiProperty({ type: Number }) total!: number
  @ApiProperty({ type: Number }) page!: number
  @ApiProperty({ type: Number }) pageSize!: number
}
export class OwnReviewsListDto {
  @ApiProperty({ type: [OwnReviewDto] }) items!: OwnReviewDto[]
  @ApiProperty({ type: Number }) total!: number
  @ApiProperty({ type: Number }) page!: number
  @ApiProperty({ type: Number }) pageSize!: number
}
export class RoleRatingDto {
  @ApiProperty({ type: Number, nullable: true }) average!: number | null
  @ApiProperty({ type: Number }) count!: number
}
export class UserRatingsDto {
  @ApiProperty({ type: RoleRatingDto }) driver!: RoleRatingDto
  @ApiProperty({ type: RoleRatingDto }) passenger!: RoleRatingDto
}
