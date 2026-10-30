import { ApiProperty, OmitType } from "@nestjs/swagger"
import {
  PublicDriverDto,
  PublicPointDto,
  PublicRideDto,
  PublicVehicleDto,
} from "./public-search.dto.js"
export class PublicDriverDetailDto extends PublicDriverDto {
  @ApiProperty({ type: String, nullable: true })
  bio!: string | null
  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 1,
    maximum: 5,
    description:
      "Среднее видимых отзывов пассажиров после завершённых поездок, либо null",
  })
  rating!: number | null
  @ApiProperty({ type: Number, minimum: 0 })
  reviewCount!: number
}
export class PublicVehicleDetailDto extends PublicVehicleDto {
  @ApiProperty({ type: Number, minimum: 1, maximum: 8 })
  passengerSeats!: number
}
export class PublicStopDto {
  @ApiProperty({ type: Number, minimum: 1 })
  position!: number
  @ApiProperty({ type: PublicPointDto })
  location!: PublicPointDto
}
export class PublicRideDetailDto extends OmitType(PublicRideDto, [
  "driver",
  "vehicle",
] as const) {
  @ApiProperty({ enum: ["PUBLISHED"] })
  status!: "PUBLISHED"
  @ApiProperty({ type: PublicDriverDetailDto })
  driver!: PublicDriverDetailDto
  @ApiProperty({ type: PublicVehicleDetailDto })
  vehicle!: PublicVehicleDetailDto
  @ApiProperty({ type: [PublicStopDto] })
  stops!: PublicStopDto[]
}
