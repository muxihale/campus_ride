import { ApiProperty } from "@nestjs/swagger"
import { Transform } from "class-transformer"
import { IsString, Length } from "class-validator"
import { UserStatus } from "../generated/prisma/enums.js"
export class ChangeUserStatusDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 500 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value
  )
  @IsString()
  @Length(1, 500)
  reason!: string
}
export class UserStatusResultDto {
  @ApiProperty({ type: String, format: "uuid" }) id!: string
  @ApiProperty({ enum: UserStatus }) status!: UserStatus
  @ApiProperty({ type: Boolean }) changed!: boolean
  @ApiProperty({ type: Number }) cancelledRides!: number
  @ApiProperty({ type: Number }) cancelledBookings!: number
  @ApiProperty({ type: Number }) revokedSessions!: number
}
