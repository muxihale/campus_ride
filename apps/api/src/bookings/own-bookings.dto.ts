import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PickType,
} from "@nestjs/swagger"
import { IsEnum, IsIn, IsOptional } from "class-validator"
import { BookingStatus, RideStatus } from "../generated/prisma/enums.js"
import { RideQueryDto } from "../rides/ride-query.dto.js"
import { PublicRideDto } from "../rides/public-search.dto.js"
import { BookingDecisionDto } from "./booking.dto.js"
export class OwnBookingsQueryDto extends OmitType(RideQueryDto, [
  "vehicleId",
  "originId",
  "destinationId",
  "status",
] as const) {
  @ApiPropertyOptional({ enum: BookingStatus })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus
  @ApiPropertyOptional({ enum: RideStatus })
  @IsOptional()
  @IsEnum(RideStatus)
  rideStatus?: RideStatus
  @ApiPropertyOptional({ enum: ["all", "upcoming", "history"], default: "all" })
  @IsIn(["all", "upcoming", "history"])
  period: "all" | "upcoming" | "history" = "all"
  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: 8,
    description: "Минимальное число мест в заявке",
  })
  override minSeats?: number
  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    maximum: 2147483647,
    description: "Максимальная зафиксированная цена места, копейки",
  })
  override maxPriceKopecks?: number
}
export class OwnBookingRideDto extends PickType(PublicRideDto, [
  "id",
  "origin",
  "destination",
  "departureAt",
  "driver",
  "vehicle",
] as const) {
  @ApiProperty({ enum: RideStatus })
  status!: RideStatus
}
export class OwnBookingDto extends BookingDecisionDto {
  @ApiProperty({ type: OwnBookingRideDto })
  ride!: OwnBookingRideDto
}
export class OwnBookingListDto {
  @ApiProperty({ type: [OwnBookingDto] })
  items!: OwnBookingDto[]
  @ApiProperty({ type: Number })
  total!: number
  @ApiProperty({ type: Number })
  page!: number
  @ApiProperty({ type: Number })
  pageSize!: number
}
