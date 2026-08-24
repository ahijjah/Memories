import { Controller, Get, Delete, Body, UseGuards } from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccountService } from './account.service';
import { DeleteAccountDto } from './dto/delete-account.dto';

@Controller('account')
@UseGuards(ClerkAuthGuard)
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Get('export')
  async export(@CurrentUser() userId: string) {
    return this.accountService.export(userId);
  }

  @Delete()
  async deleteAccount(
    @CurrentUser() userId: string,
    @Body() dto: DeleteAccountDto,
  ) {
    return this.accountService.deleteAccount(userId, dto.confirmEmail);
  }
}
