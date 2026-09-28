import * as fs from 'fs';
import * as path from 'path';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MemoryService } from './memory.service';
import { MemoryDeletionProcessor } from './deletion.processor';
import { CreateMemoryDto } from './dto/create-memory.dto';
import { MAX_MEMORY_TEXT, memoryTextLength } from './memory-text';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import { AiQueueService } from '../ai/ai-queue.service';
import { AssetsService } from '../assets/assets.service';
import { MemoryDeletionQueueService } from './deletion-queue.service';
import { AccountService } from '../account/account.service';
import { VaultService } from '../vault/vault.service';

// LOSSLESS-CAPTURE-01: full text is preserved completely or explicitly rejected, never truncated,
// and returned only by the authorized Detail paths and export.
const KEY = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('CreateMemoryDto body validation (global ValidationPipe settings)', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const validate = (value: Record<string, unknown>) =>
    pipe.transform(value, { type: 'body', metatype: CreateMemoryDto });

  it('the limit is 20,000 characters', () => {
    expect(MAX_MEMORY_TEXT).toBe(20_000);
  });

  it('a request without body (older clients) is valid and unchanged', async () => {
    const dto = await validate({ sourceType: 'text', idempotencyKey: KEY, title: 'Hello' });
    expect(dto).toEqual(Object.assign(new CreateMemoryDto(), { sourceType: 'text', idempotencyKey: KEY, title: 'Hello' }));
  });

  it('exactly 20,000 characters is accepted, byte-for-byte', async () => {
    const body = `${'a'.repeat(MAX_MEMORY_TEXT - 2)}\n `;
    const dto = await validate({ sourceType: 'text', idempotencyKey: KEY, body });
    expect(dto.body).toBe(body);
  });

  it('20,001 characters is rejected with a sanitized validation error', async () => {
    const error = await validate({ sourceType: 'text', idempotencyKey: KEY, body: 'a'.repeat(MAX_MEMORY_TEXT + 1) }).catch((e) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse().message).toEqual(['body must be text of at most 20000 characters']);
  });

  it('counts code points like PostgreSQL char_length (emoji and variation selectors)', async () => {
    expect(memoryTextLength('a😀b')).toBe(3);
    expect(memoryTextLength('❤️')).toBe(2); // U+2764 + U+FE0F: two characters for char_length
    await expect(validate({ sourceType: 'text', idempotencyKey: KEY, body: '😀'.repeat(MAX_MEMORY_TEXT) })).resolves.toBeDefined();
    // 10,001 "❤️" is 20,002 code points: class-validator's MaxLength would count 10,001.
    await expect(validate({ sourceType: 'text', idempotencyKey: KEY, body: '❤️'.repeat(10_001) })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a non-string body is rejected', async () => {
    await expect(validate({ sourceType: 'text', idempotencyKey: KEY, body: 42 })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('MemoryService: saving and reading full text', () => {
  let service: MemoryService;
  const prisma: any = {
    memory: { findUnique: jest.fn(), create: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  };
  const aiQueue = { enqueueUnderstanding: jest.fn() };
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: 'mem-1',
    userId: 'user-1',
    sourceType: 'text',
    sourceUri: null,
    title: 'First line',
    securityScope: 'private',
    processingState: 'queued',
    content: null,
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MemoryService,
        { provide: PrismaService, useValue: prisma },
        { provide: AiQueueService, useValue: aiQueue },
        { provide: AssetsService, useValue: {} },
        { provide: MemoryDeletionQueueService, useValue: {} },
        { provide: FieldEncryptionService, useValue: { decrypt: (v: unknown) => v } },
        { provide: ConfigService, useValue: { getOrThrow: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(MemoryService);
    prisma.memory.findUnique.mockResolvedValue(null);
  });

  it('create without body: no content row, response body null', async () => {
    prisma.memory.create.mockResolvedValue(row());

    const result = await service.create('user-1', { sourceType: 'text', idempotencyKey: KEY, title: 'First line' } as any);

    expect(prisma.memory.create.mock.calls[0][0].data).not.toHaveProperty('content');
    expect(result).toMatchObject({ id: 'mem-1', body: null });
    expect(result).not.toHaveProperty('content');
  });

  it('create with body: Memory and full text are written in one nested create (atomic)', async () => {
    const body = 'First line\nsecond line with all the details';
    prisma.memory.create.mockResolvedValue(row({ content: { text: body } }));

    const result = await service.create('user-1', { sourceType: 'text', idempotencyKey: KEY, title: 'First line', body } as any);

    expect(prisma.memory.create).toHaveBeenCalledTimes(1);
    expect(prisma.memory.create.mock.calls[0][0]).toMatchObject({
      data: { title: 'First line', content: { create: { text: body } } },
      include: { content: true },
    });
    expect(result.body).toBe(body);
    expect(aiQueue.enqueueUnderstanding).toHaveBeenCalledWith('mem-1');
  });

  it('a failed create writes nothing and does not enqueue', async () => {
    prisma.memory.create.mockRejectedValue(new Error('db down'));

    await expect(service.create('user-1', { sourceType: 'text', idempotencyKey: KEY, body: 'x' } as any)).rejects.toThrow('db down');
    expect(aiQueue.enqueueUnderstanding).not.toHaveBeenCalled();
  });

  it('idempotent replay returns the same Memory and body without creating or enqueueing', async () => {
    prisma.memory.findUnique.mockResolvedValue(row({ content: { text: 'full text' } }));

    const result = await service.create('user-1', { sourceType: 'text', idempotencyKey: KEY, body: 'full text' } as any);

    expect(prisma.memory.findUnique).toHaveBeenCalledWith({ where: { idempotencyKey: KEY }, include: { content: true } });
    expect(prisma.memory.create).not.toHaveBeenCalled();
    expect(aiQueue.enqueueUnderstanding).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'mem-1', body: 'full text' });
  });

  it("replay of another user's key is forbidden", async () => {
    prisma.memory.findUnique.mockResolvedValue(row({ userId: 'user-2' }));

    await expect(service.create('user-1', { sourceType: 'text', idempotencyKey: KEY } as any)).rejects.toBeInstanceOf(ForbiddenException);
  });

  const conflict = (target: unknown) =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0', meta: { target } });

  it.each([[['idempotencyKey']], ['memories_idempotencyKey_key']])(
    'concurrent same-key create (P2002, target %p): returns the winner instead of a 500, no second enqueue',
    async (target) => {
      prisma.memory.findUnique
        .mockResolvedValueOnce(null) // pre-check: nothing yet
        .mockResolvedValueOnce(row({ id: 'mem-winner', content: { text: 'full text' } }));
      prisma.memory.create.mockRejectedValue(conflict(target));

      const result = await service.create('user-1', { sourceType: 'text', idempotencyKey: KEY, body: 'full text' } as any);

      expect(result).toMatchObject({ id: 'mem-winner', body: 'full text' });
      expect(aiQueue.enqueueUnderstanding).not.toHaveBeenCalled();
    },
  );

  it('a unique violation on another field is not treated as a replay', async () => {
    prisma.memory.create.mockRejectedValue(conflict(['somethingElse']));

    await expect(service.create('user-1', { sourceType: 'text', idempotencyKey: KEY } as any)).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
  });

  it('Detail loads the content and returns it as body', async () => {
    prisma.memory.findUnique.mockResolvedValue(row({ assets: [], aiInferences: [], userConfirmations: [], content: { text: 'full text' } }));
    prisma.memory.update.mockResolvedValue({});

    const result = await service.findOneForUser('user-1', 'mem-1');

    expect(prisma.memory.findUnique.mock.calls[0][0].include.content).toBe(true);
    expect(result.body).toBe('full text');
    expect(result).not.toHaveProperty('content');
  });

  it('Detail of a legacy Memory: body null, nothing fabricated from the title', async () => {
    prisma.memory.findUnique.mockResolvedValue(row({ assets: [], aiInferences: [], userConfirmations: [] }));
    prisma.memory.update.mockResolvedValue({});

    const result = await service.findOneForUser('user-1', 'mem-1');

    expect(result.body).toBeNull();
    expect(result.title).toBe('First line');
  });

  it('Detail of a Vault Memory is still 404 (body never returned here)', async () => {
    prisma.memory.findUnique.mockResolvedValue(row({ securityScope: 'vault', assets: [], aiInferences: [], userConfirmations: [], content: { text: 'secret' } }));

    await expect(service.findOneForUser('user-1', 'mem-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it("Detail of another user's Memory is forbidden", async () => {
    prisma.memory.findUnique.mockResolvedValue(row({ userId: 'user-2', assets: [], aiInferences: [], userConfirmations: [], content: { text: 'x' } }));

    await expect(service.findOneForUser('user-1', 'mem-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the Memory list never loads the content', async () => {
    prisma.memory.findMany.mockResolvedValue([]);

    await service.findAllForUser('user-1');

    expect(prisma.memory.findMany.mock.calls[0][0].include).not.toHaveProperty('content');
  });
});

describe('Account export and deletion', () => {
  it('export includes the full text as body (null when absent)', async () => {
    const prisma: any = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }) },
      memory: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'm1', title: 't', content: { text: 'full text' } },
          { id: 'm2', title: 'legacy', content: null },
        ]),
      },
      collection: { findMany: jest.fn().mockResolvedValue([]) },
      reminder: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const config = { getOrThrow: () => 'x' } as any;
    const account = new AccountService(prisma, config, {} as any);

    const result: any = await account.export('user-1');

    expect(prisma.memory.findMany.mock.calls[0][0].select.content).toEqual({ select: { text: true } });
    expect(result.memories).toEqual([
      { id: 'm1', title: 't', body: 'full text' },
      { id: 'm2', title: 'legacy', body: null },
    ]);
  });

  it('memory deletion finalization removes the content in the same transaction as the state change', async () => {
    const prisma: any = {
      memory: {
        findUnique: jest.fn().mockResolvedValue({ id: 'mem-1', lifecycleState: 'deleted_pending' }),
        update: jest.fn((args) => ({ op: 'update', args })),
      },
      memoryAsset: { findMany: jest.fn().mockResolvedValue([]) },
      memoryContent: { deleteMany: jest.fn((args) => ({ op: 'deleteContent', args })) },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const config = { getOrThrow: () => 'x' } as any;
    const processor = new MemoryDeletionProcessor(prisma, config, { getSseParams: () => ({}) } as any);

    await processor.process({ data: { memoryId: 'mem-1' } } as any);

    expect(prisma.$transaction).toHaveBeenCalledWith([
      { op: 'deleteContent', args: { where: { memoryId: 'mem-1' } } },
      { op: 'update', args: { where: { id: 'mem-1' }, data: { lifecycleState: 'deleted' } } },
    ]);
  });

  it('a restored (not deleted_pending) Memory keeps its content', async () => {
    const prisma: any = {
      memory: { findUnique: jest.fn().mockResolvedValue({ id: 'mem-1', lifecycleState: 'active' }) },
      memoryContent: { deleteMany: jest.fn() },
      $transaction: jest.fn(),
    };
    const processor = new MemoryDeletionProcessor(prisma, { getOrThrow: () => 'x' } as any, {} as any);

    await processor.process({ data: { memoryId: 'mem-1' } } as any);

    expect(prisma.memoryContent.deleteMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('Vault: full text only through the authorized Vault Detail', () => {
  const vaultRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'mem-v',
    userId: 'user-1',
    securityScope: 'vault',
    assets: [],
    aiInferences: [],
    userConfirmations: [],
    content: { text: 'vault note' },
    ...overrides,
  });
  const make = (prisma: any) => new VaultService(prisma, {} as any, {} as any, { decrypt: (v: unknown) => v } as any);

  it('Vault Detail returns body after the ownership and Vault checks', async () => {
    const prisma: any = { memory: { findUnique: jest.fn().mockResolvedValue(vaultRow()) } };

    const result: any = await make(prisma).findOneForUser('user-1', 'mem-v');

    expect(prisma.memory.findUnique.mock.calls[0][0].include.content).toBe(true);
    expect(result.body).toBe('vault note');
    expect(result).not.toHaveProperty('content');
  });

  it('a non-Vault Memory is 404 on the Vault path', async () => {
    const prisma: any = { memory: { findUnique: jest.fn().mockResolvedValue(vaultRow({ securityScope: 'private' })) } };

    await expect(make(prisma).findOneForUser('user-1', 'mem-v')).rejects.toBeInstanceOf(NotFoundException);
  });

  it("another user's Vault Memory is forbidden", async () => {
    const prisma: any = { memory: { findUnique: jest.fn().mockResolvedValue(vaultRow({ userId: 'user-2' })) } };

    await expect(make(prisma).findOneForUser('user-1', 'mem-v')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the Vault list never loads the content', async () => {
    const prisma: any = { memory: { findMany: jest.fn().mockResolvedValue([]) } };

    await make(prisma).findAllForUser('user-1');

    expect(prisma.memory.findMany.mock.calls[0][0].include).toEqual({ assets: true });
  });
});

describe('Schema, migration and exposure guards', () => {
  const apiRoot = path.resolve(__dirname, '../../..');

  it('the migration creates memory_contents with a cascading FK and the 20,000 CHECK, no backfill', () => {
    const sql = fs.readFileSync(path.join(apiRoot, 'prisma/migrations/20260928_add_memory_content/migration.sql'), 'utf8');
    expect(sql).toContain('CREATE TABLE "memory_contents"');
    expect(sql).toContain('"text" TEXT NOT NULL');
    expect(sql).toContain('CHECK (char_length("text") <= 20000)');
    expect(sql).toMatch(/FOREIGN KEY \("memoryId"\) REFERENCES "memories"\("id"\) ON DELETE CASCADE/);
    expect(sql).not.toMatch(/INSERT|UPDATE "memories"/);
  });

  it('only the approved paths ever load or touch the full text', () => {
    const allowed = new Set([
      'modules/memory/memory.service.ts', // create response, Detail
      'modules/vault/vault.service.ts', // Vault Detail
      'modules/account/account.service.ts', // export
      'modules/memory/deletion.processor.ts', // finalization
      'modules/ai/ai.processor.ts', // AI input
    ]);
    const srcRoot = path.join(apiRoot, 'src');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
          const text = fs.readFileSync(full, 'utf8');
          if (/\bcontent:\s*(true|\{)|memoryContent|memory_contents/.test(text)) {
            offenders.push(path.relative(srcRoot, full));
          }
        }
      }
    };
    walk(srcRoot);
    expect(offenders.filter((f) => !allowed.has(f))).toEqual([]);
  });
});
