import { ApiProperty } from "@nestjs/swagger"
import { Transform } from "class-transformer"
import { IsInt, IsUUID, IsString, Length, Max, Min } from "class-validator"
import { BookingStatus } from "../generated/prisma/enums.js"
export class CreateBookingDto {
  @ApiProperty({ type: Number, minimum: 1, maximum: 8 })
  @IsInt()
  @Min(1)
  @Max(8)
  seats!: number

  @ApiProperty({
    type: String,
    format: "uuid",
    description:
      "Ключ повторной отправки. Один UUID для одной попытки бронирования.",
  })
  @IsUUID()
  requestKey!: string
}
export class BookingDto {
  @ApiProperty({ type: String, format: "uuid" })
  id!: string
  @ApiProperty({ type: String, format: "uuid" })
  rideId!: string
  @ApiProperty({ type: String, format: "uuid" })
  passengerId!: string
  @ApiProperty({ type: String, format: "uuid" })
  requestKey!: string
  @ApiProperty({ type: Number })
  seats!: number
  @ApiProperty({
    type: Number,
    description: "Цена места на момент заявки, в копейках",
  })
  unitPriceKopecks!: number
  @ApiProperty({ enum: BookingStatus, enumName: "BookingStatus" })
  status!: BookingStatus
  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date
}

export class ConfirmBookingDto {}
export class RejectBookingDto {
  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: 500,
    description: "Причина отклонения",
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value
  )
  @IsString()
  @Length(1, 500)
  reason!: string
}
export class BookingDecisionDto extends BookingDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: "Причина отклонения, иначе null",
  })
  cancellationReason!: string | null
}
