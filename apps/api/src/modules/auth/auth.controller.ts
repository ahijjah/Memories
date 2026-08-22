import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';
import { AuthService } from './auth.service';

class DevLoginDto {
  @IsEmail()
  email!: string;
}

// DEV-ONLY endpoint. This exists so local development and the seed dataset
// (spec §25) can authenticate without standing up a full managed identity
// provider first. Replace/remove before any real deployment — see ADR-001.
@ApiTags('auth (dev-only)')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('dev-login')
  async devLogin(@Body() dto: DevLoginDto) {
    return this.authService.issueDevToken(dto.email);
  }
}
