import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SearchService, SearchResult } from './search.service';
import { SearchQueryDto } from './search-query.dto';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';

@Controller('search')
@UseGuards(ClerkAuthGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  async search(@Query() dto: SearchQueryDto): Promise<SearchResult[]> {
    return this.searchService.search(dto.query);
  }
}
