import { Transform } from "class-transformer"
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from "class-validator"
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger"
import { Role } from "../generated/prisma/enums.js"

export class LoginDto {
  @ApiProperty({
    type: String,
    example: "student@campusride.test",
    maxLength: 254,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value
  )
  @IsEmail({}, { message: "Укажите корректный email" })
  @MaxLength(254)
  email!: string

  @ApiProperty({
    type: String,
    minLength: 10,
    maxLength: 128,
    format: "password",
    writeOnly: true,
  })
  @IsString()
  @Length(10, 128, { message: "Пароль должен содержать от 10 до 128 символов" })
  password!: string
}

export class RegisterDto extends LoginDto {
  @ApiProperty({
    type: String,
    example: "Анна Соколова",
    minLength: 2,
    maxLength: 100,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value
  )
  @IsString()
  @Length(2, 100, { message: "Имя должно содержать от 2 до 100 символов" })
  fullName!: string

  @ApiPropertyOptional({
    type: String,
    example: "Студент ИРИТ-РТФ",
    maxLength: 200,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value
  )
  @IsOptional()
  @IsString()
  @MaxLength(200)
  affiliation?: string
}

export class CurrentUserDto {
  @ApiProperty({ type: String, format: "uuid" })
  id!: string

  @ApiProperty({ type: String })
  email!: string

  @ApiProperty({ type: String })
  fullName!: string

  @ApiProperty({ type: String, nullable: true })
  affiliation!: string | null

  @ApiProperty({ enum: Role, isArray: true })
  roles!: Role[]
}
