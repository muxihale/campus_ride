import { ApiProperty } from "@nestjs/swagger"
import { IsInt, IsUUID, Max, Min } from "class-validator"
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
