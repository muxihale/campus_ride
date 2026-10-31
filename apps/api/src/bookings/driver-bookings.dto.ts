import { ApiProperty, ApiPropertyOptional, OmitType } from "@nestjs/swagger"
import { IsOptional, IsUUID } from "class-validator"
import {
  OwnBookingDto,
  OwnBookingRideDto,
  OwnBookingsQueryDto,
} from "./own-bookings.dto.js"
export class DriverBookingsQueryDto extends OwnBookingsQueryDto {
  @ApiPropertyOptional({ type: String, format: "uuid" })
  @IsOptional()
  @IsUUID()
  rideId?: string
}
class PassengerDto {
  @ApiProperty({ type: String, format: "uuid" })
  id!: string
  @ApiProperty({ type: String })
  fullName!: string
  @ApiProperty({ type: String, nullable: true })
  affiliation!: string | null
}
class DriverBookingRideDto extends OwnBookingRideDto {
  @ApiProperty({
    type: Number,
    description: "Текущий остаток после резерва PENDING/CONFIRMED",
  })
  availableSeats!: number
}
export class DriverBookingDto extends OmitType(OwnBookingDto, [
  "requestKey",
  "ride",
] as const) {
  @ApiProperty({ type: PassengerDto })
  passenger!: PassengerDto
  @ApiProperty({ type: DriverBookingRideDto })
  ride!: DriverBookingRideDto
}
export class DriverBookingListDto {
  @ApiProperty({ type: [DriverBookingDto] })
  items!: DriverBookingDto[]
  @ApiProperty({ type: Number })
  total!: number
  @ApiProperty({ type: Number })
  page!: number
  @ApiProperty({ type: Number })
  pageSize!: number
}
