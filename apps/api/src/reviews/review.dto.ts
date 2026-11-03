import { ApiProperty } from "@nestjs/swagger"
import { Transform } from "class-transformer"
import { IsInt, IsString, Length, Max, Min } from "class-validator"

export class CreateReviewDto {
  @ApiProperty({ type: Number, minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number

  @ApiProperty({ type: String, minLength: 1, maxLength: 1000 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value
  )
  @IsString()
  @Length(1, 1000)
  comment!: string
}
export class ReviewDto {
  @ApiProperty({ type: String, format: "uuid" }) id!: string
  @ApiProperty({ type: String, format: "uuid" }) bookingId!: string
  @ApiProperty({ type: String, format: "uuid" }) authorId!: string
  @ApiProperty({ type: String, format: "uuid" }) recipientId!: string
  @ApiProperty({ type: Number, minimum: 1, maximum: 5 }) rating!: number
  @ApiProperty({ type: String }) comment!: string
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: Date
}
