import { Controller, Get, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { PersonService } from './person.service';
import { CreatePersonDto } from './dto/create-person.dto';

@UseGuards(ClerkAuthGuard)
@Controller('people')
export class PersonController {
  constructor(private readonly personService: PersonService) {}

  @Get()
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async list(@CurrentUser() user: CurrentUserPayload) {
    return this.personService.listPeople(user.sub);
  }

  @Post()
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreatePersonDto) {
    return this.personService.createPerson(user.sub, dto);
  }

  @Delete(':personId')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async delete(@CurrentUser() user: CurrentUserPayload, @Param('personId') personId: string) {
    return this.personService.deletePerson(user.sub, personId);
  }

  @Post(':personId/assign-to-memory/:memoryId')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async assignToMemory(
    @CurrentUser() user: CurrentUserPayload,
    @Param('personId') personId: string,
    @Param('memoryId') memoryId: string,
  ) {
    return this.personService.assignPersonToMemory(user.sub, personId, memoryId);
  }

  @Delete(':personId/assign-to-memory/:memoryId')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async unassignFromMemory(
    @CurrentUser() user: CurrentUserPayload,
    @Param('personId') personId: string,
    @Param('memoryId') memoryId: string,
  ) {
    return this.personService.unassignPersonFromMemory(user.sub, personId, memoryId);
  }
}
