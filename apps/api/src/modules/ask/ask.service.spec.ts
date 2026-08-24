import { Test, TestingModule } from '@nestjs/testing';
import { AskService } from './ask.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmbeddingService } from '../ai/embedding.service';

jest.mock('@memory-app/ai', () => {
  const actual = jest.requireActual('@memory-app/ai');
  return {
    ...actual,
    AnthropicAiProvider: jest.fn().mockImplementation(() => ({
      answerWithContext: jest.fn().mockResolvedValue({
        answer: 'Test answer',
        citedMemoryIds: ['mem-1'],
      }),
    })),
  };
});

describe('AskService', () => {
  let service: AskService;
  let prismaService: PrismaService;
  let embeddingService: EmbeddingService;

  beforeEach(async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AskService,
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

    service = module.get<AskService>(AskService);
    prismaService = module.get<PrismaService>(PrismaService);
    embeddingService = module.get<EmbeddingService>(EmbeddingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should include userId in retrieval WHERE clause (security requirement)', async () => {
    const userId = 'user-123';
    const question = 'What did I learn about AI?';
    const mockMemories = [
      {
        memoryId: 'mem-1',
        title: 'AI Concepts',
        summary: 'A summary about AI',
        sourceUri: null,
      },
    ];

    jest.spyOn(prismaService, '$queryRaw').mockResolvedValue(mockMemories);

    await service.ask(userId, question);

    expect(prismaService.$queryRaw).toHaveBeenCalled();
    const queryCall = (prismaService.$queryRaw as jest.Mock).mock.calls[0];
    const queryString = queryCall[0].join('');

    // Verify userId is in WHERE clause
    expect(queryString).toContain('WHERE m."userId"');
    // Verify lifecycleState filter
    expect(queryString).toContain('m."lifecycleState" != \'deleted\'');
  });

  it('should return early without calling AI provider when no memories found', async () => {
    const userId = 'user-123';
    const question = 'What did I learn?';

    jest.spyOn(prismaService, '$queryRaw').mockResolvedValue([]);

    const result = await service.ask(userId, question);

    expect(result).toEqual({
      answer: "I don't have any saved information relevant to that question yet.",
      citedMemoryIds: [],
      sources: [],
    });
    // Verify embedding was still called (to try to find memories)
    expect(embeddingService.embed).toHaveBeenCalledWith(question, 'query');
  });

  it('should return answer with cited sources on happy path', async () => {
    const userId = 'user-123';
    const question = 'What did I learn about AI?';
    const mockMemories = [
      {
        memoryId: 'mem-1',
        title: 'AI Concepts',
        summary: 'A summary about AI',
        sourceUri: 'https://example.com/ai',
      },
      {
        memoryId: 'mem-2',
        title: 'ML Basics',
        summary: 'Machine learning fundamentals',
        sourceUri: null,
      },
    ];

    jest.spyOn(prismaService, '$queryRaw').mockResolvedValue(mockMemories);

    const result = await service.ask(userId, question);

    expect(result.answer).toBeDefined();
    expect(result.citedMemoryIds).toContain('mem-1');
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].memoryId).toBe('mem-1');
  });
});
