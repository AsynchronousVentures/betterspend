import { IsEmail, IsString, Length, Matches } from 'class-validator';

export class BootstrapInstanceDto {
  @IsString()
  @Length(1, 255)
  @Matches(/\S/, { message: 'organizationName cannot be blank' })
  organizationName!: string;

  @IsString()
  @Length(1, 255)
  @Matches(/\S/, { message: 'name cannot be blank' })
  name!: string;

  @IsEmail()
  @Length(3, 255)
  email!: string;

  @IsString()
  @Length(8, 128)
  password!: string;
}
