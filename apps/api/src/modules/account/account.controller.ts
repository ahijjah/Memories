import { Controller, Get, Delete, Body, UseGuards } from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { AccountService } from './account.service';
import { DeleteAccountDto } from './dto/delete-account.dto';

@Controller('account')
@UseGuards(ClerkAuthGuard)
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Get('export')
  async export(@CurrentUser() user: CurrentUserPayload) {
    return this.accountService.export(user.sub);
  }

  @Delete()
  async deleteAccount(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: DeleteAccountDto,
  ) {
    return this.accountService.deleteAccount(user.sub, dto.confirmEmail);
  }
}
