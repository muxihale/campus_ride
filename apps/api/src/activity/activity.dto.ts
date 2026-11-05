import { ApiProperty, ApiPropertyOptional, PickType } from "@nestjs/swagger"
import { IsIn, IsOptional, IsUUID } from "class-validator"
import { ReviewsQueryDto } from "../reviews/review-query.dto.js"
export const adminActions = [
  "user.blocked",
  "user.unblocked",
  "review.hidden",
  "review.restored",
  "ride.cancelled",
  "booking.cancelled",
  "payment.cancelled",
  "payment.refunded",
] as const
export const activityActions = [
  ...adminActions,
  "ride.started",
  "ride.completed",
  "booking.rejected",
  "booking.completed",
  "payment.succeeded",
  "review.created",
] as const
export class ActivityFiltersDto extends PickType(ReviewsQueryDto, [
  "q",
  "page",
  "pageSize",
  "dateFrom",
  "dateTo",
  "sort",
] as const) {
  @ApiPropertyOptional({
    enum: ["user", "review", "ride", "booking", "payment"],
  })
  @IsOptional()
  @IsIn(["user", "review", "ride", "booking", "payment"])
  resourceType?: string
  @ApiPropertyOptional({ type: String, format: "uuid" })
  @IsOptional()
  @IsUUID()
  resourceId?: string
}
export class ActivityQueryDto extends ActivityFiltersDto {
  @ApiPropertyOptional({ enum: activityActions })
  @IsOptional()
  @IsIn(activityActions)
  action?: string
}
export class ActivityDto {
  @ApiProperty({ type: String, format: "uuid" }) id!: string
  @ApiProperty({ type: String }) action!: string
  @ApiProperty({ type: String }) resourceType!: string
  @ApiProperty({ type: String, format: "uuid" }) resourceId!: string
  @ApiProperty({ type: String, nullable: true }) reason!: string | null
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: Date
}
export class ActivityListDto {
  @ApiProperty({ type: [ActivityDto] }) items!: ActivityDto[]
  @ApiProperty({ type: Number }) total!: number
  @ApiProperty({ type: Number }) page!: number
  @ApiProperty({ type: Number }) pageSize!: number
}
