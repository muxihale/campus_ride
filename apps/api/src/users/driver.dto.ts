import { Transform, Type } from "class-transformer"
import {
  IsDefined,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator"
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger"

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value
const plateLetters: Record<string, string> = {
  А: "A",
  В: "B",
  Е: "E",
  К: "K",
  М: "M",
  Н: "H",
  О: "O",
  Р: "P",
  С: "C",
  Т: "T",
  У: "Y",
  Х: "X",
}

export function normalizeRegistrationNumber(value: string): string {
  return value
    .toUpperCase()
    .replace(/\s/g, "")
    .replace(/[АВЕКМНОРСТУХ]/g, (letter) => plateLetters[letter]!)
}

export class CreateVehicleDto {
  @ApiProperty({ type: String, example: "Kia", maxLength: 60 })
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  make!: string

  @ApiProperty({ type: String, example: "Rio", maxLength: 60 })
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  model!: string

  @ApiProperty({ type: String, example: "Белый", maxLength: 40 })
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  color!: string

  @ApiProperty({
    type: String,
    example: "А123ВС196",
    description:
      "Стандартный номер легкового автомобиля РФ; кириллица и латиница приводятся к единому виду",
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? normalizeRegistrationNumber(value) : value
  )
  @IsString()
  @Matches(/^[ABEKMHOPCTYX][0-9]{3}[ABEKMHOPCTYX]{2}[0-9]{2,3}$/, {
    message: "Укажите госномер в формате А123ВС196",
  })
  registrationNumber!: string

  @ApiProperty({
    type: Number,
    minimum: 1,
    maximum: 8,
    example: 3,
    description: "Количество мест для пассажиров, без водителя",
  })
  @IsInt()
  @Min(1)
  @Max(8)
  passengerSeats!: number
}

export class BecomeDriverDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 1000,
    example: "Езжу в главный корпус УрФУ по будням к 8:30.",
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  bio?: string | null

  @ApiProperty({ type: CreateVehicleDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CreateVehicleDto)
  vehicle!: CreateVehicleDto
}
