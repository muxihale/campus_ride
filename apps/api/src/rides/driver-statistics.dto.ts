import { ApiProperty, PickType } from "@nestjs/swagger"
import { ReviewsQueryDto } from "../reviews/review-query.dto.js"
export class DriverStatisticsQueryDto extends PickType(ReviewsQueryDto, [
  "dateFrom",
  "dateTo",
] as const) {}
export class DriverStatisticsDto {
  @ApiProperty({ type: String, nullable: true, format: "date-time" })
  dateFrom!: string | null
  @ApiProperty({ type: String, nullable: true, format: "date-time" }) dateTo!:
    string | null
  @ApiProperty({ enum: ["departureAt"] }) periodBasis!: "departureAt"
  @ApiProperty({ type: Boolean, example: true }) isDemo!: true
  @ApiProperty({ enum: ["RUB"] }) currency!: "RUB"
  @ApiProperty({
    type: Number,
    description: "Все сохранившиеся поездки выбранного периода",
  })
  ridesTotal!: number
  @ApiProperty({ type: Number }) draftRides!: number
  @ApiProperty({ type: Number }) publishedRides!: number
  @ApiProperty({ type: Number }) inProgressRides!: number
  @ApiProperty({ type: Number }) completedRides!: number
  @ApiProperty({ type: Number }) cancelledRides!: number
  @ApiProperty({ type: Number }) completedBookings!: number
  @ApiProperty({
    type: Number,
    description:
      "Уникальные аккаунты пассажиров завершённых заявок завершённых поездок",
  })
  passengersTransported!: number
  @ApiProperty({
    type: Number,
    description:
      "Сумма мест завершённых заявок завершённых поездок, включая попутчиков без отдельного аккаунта",
  })
  seatsTransported!: number
  @ApiProperty({ type: Number }) cancelledBookings!: number
  @ApiProperty({ type: Number }) rejectedBookings!: number
  @ApiProperty({
    type: String,
    pattern: "^\\d+$",
    example: "30000",
    description:
      "Сохранённые успешные демо-оплаты подтверждённых и завершённых участий, копейки. Возвраты уже исключены, повторно не вычитаются.",
  })
  demoReceiptsKopecks!: string
  @ApiProperty({
    type: String,
    pattern: "^\\d+$",
    example: "15000",
    description: "Часть демо-поступлений за завершённые участия, копейки",
  })
  demoCompletedRevenueKopecks!: string
  @ApiProperty({
    type: String,
    pattern: "^\\d+$",
    example: "15000",
    description: "Демо-возвраты отменённых заявок, копейки",
  })
  demoRefundsKopecks!: string
}
