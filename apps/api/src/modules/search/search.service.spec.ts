import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmbeddingService } from '../ai/embedding.service';

describe('SearchService', () => {
  let service: SearchService;
  let prismaService: PrismaService;
  let embeddingService: EmbeddingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn(),
          },
        },
        {
          provide: EmbeddingService,
          useValue: {
            embed: jest.fn().mockResolvedValue(new Array(1024).fill(0.1)),
          },
        },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
    prismaService = module.get<PrismaService>(PrismaService);
    embeddingService = module.get<EmbeddingService>(EmbeddingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should include userId in WHERE clause for user scoping (BR-SEC-001)', async () => {
    const userId = 'test-user-123';
    const query = 'test query';
    const mockResults = [
      {
        id: 'memory-1',
        title: 'Test Memory',
        summary: 'A test summary',
        sourceUri: null,
        distance: 0.1,
        createdAt: new Date(),
      },
    ];

    jest.spyOn(prismaService, '$queryRaw').mockResolvedValue(mockResults);

    const results = await service.search(userId, query);

    expect(embeddingService.embed).toHaveBeenCalledWith(query, 'query');
    expect(prismaService.$queryRaw).toHaveBeenCalled();

    const queryCall = (prismaService.$queryRaw as jest.Mock).mock.calls[0];
    const queryParts = queryCall[0];
    const queryString = queryParts.join('');

    // Verify userId is included in WHERE clause
    expect(queryString).toContain('WHERE m."userId"');
    expect(queryString).toContain('m."lifecycleState"');
    // Verify lifecycleState filter is included
    expect(queryString).toContain('!= \'deleted\'');
    // Verify LATERAL JOIN for summary
    expect(queryString).toContain('LEFT JOIN LATERAL');
    expect(queryString).toContain('ai."field" = \'summary\'');

    // Verify userId parameter was passed
    expect(queryCall).toContain(userId);

    expect(results).toEqual(mockResults);
  });
});
