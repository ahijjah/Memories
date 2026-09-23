import { Controller, Get, Param, Query, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { WorkspaceService } from './workspace.service';

@ApiTags('workspaces')
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('workspaces')
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Get()
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    let parsedLimit = limit ? Math.min(parseInt(limit, 10), 50) : 50;
    if (isNaN(parsedLimit) || parsedLimit < 1) {
      parsedLimit = 50;
    }

    let parsedOffset = offset ? Math.max(parseInt(offset, 10), 0) : 0;
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      parsedOffset = 0;
    }

    return this.workspaceService.listWorkspaces(user.sub, parsedLimit, parsedOffset);
  }

  @Get(':workspaceId/memories')
  async getMemories(
    @CurrentUser() user: CurrentUserPayload,
    @Param('workspaceId') workspaceId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    let parsedLimit = limit ? Math.min(parseInt(limit, 10), 20) : 20;
    if (isNaN(parsedLimit) || parsedLimit < 1) {
      parsedLimit = 20;
    }

    let parsedOffset = offset ? Math.max(parseInt(offset, 10), 0) : 0;
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      parsedOffset = 0;
    }

    try {
      return await this.workspaceService.getWorkspaceMemories(
        user.sub,
        workspaceId,
        parsedLimit,
        parsedOffset,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('Workspace not found')) {
        throw new HttpException('Workspace not found', HttpStatus.NOT_FOUND);
      }
      throw error;
    }
  }
}
