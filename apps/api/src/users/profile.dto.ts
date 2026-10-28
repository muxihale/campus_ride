import { Transform } from "class-transformer"
import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from "class-validator"
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger"
import { CurrentUserDto } from "../auth/auth.dto.js"

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value

export class UpdateProfileDto {
  @ApiPropertyOptional({
    type: String,
    minLength: 2,
    maxLength: 100,
    example: "Анна Соколова",
  })
  @Transform(trim)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Length(2, 100, { message: "Имя должно содержать от 2 до 100 символов" })
  fullName?: string

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 32,
    example: "+7 (912) 345-67-89",
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() || null : value
  )
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(/^\+?[0-9][0-9 ()-]{3,30}[0-9]$/, {
    message:
      "Укажите телефон: цифры, пробелы, скобки, дефисы и необязательный + в начале",
  })
  phone?: string | null

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 200,
    example: "Студент ИРИТ-РТФ УрФУ",
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() || null : value
  )
  @IsOptional()
  @IsString()
  @MaxLength(200)
  affiliation?: string | null
}

export class ProfileDto extends CurrentUserDto {
  @ApiProperty({ type: String, nullable: true })
  phone!: string | null
}
