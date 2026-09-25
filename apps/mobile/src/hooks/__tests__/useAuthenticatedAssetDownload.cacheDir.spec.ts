import * as expoFileSystem from 'expo-file-system';
import { File, Directory, Paths } from 'expo-file-system';
import { performDownload, getOrStartAssetDownload, downloadPromises } from '../useAuthenticatedAssetDownload';

// No jest.mock('expo-file-system') here: jest.config maps the module to
// __mocks__/expo-file-system.js, and automocking that file would turn its v57 directory
// semantics into no-ops. These tests need those semantics to run.
const fsMock = expoFileSystem as unknown as {
  __resetDirectories: () => void;
  __hasDirectory: (uri: string) => boolean;
};

const ASSETS_DIR_URI = 'cache/assets';
const TOKEN = 'test-token';

describe('authenticated asset cache directory (expo-file-system v57)', () => {
  let createSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    downloadPromises.clear();
    fsMock.__resetDirectories();
    createSpy = jest.spyOn(Directory.prototype, 'create');
    (File.downloadFileAsync as jest.Mock).mockImplementation(async (_url: string, file: { uri: string }) => ({
      uri: file.uri,
    }));
  });

  afterEach(() => {
    createSpy.mockRestore();
  });

  it('A. creates cache/assets on a fresh cache and proceeds to download', async () => {
    (Paths.info as jest.Mock).mockReturnValue({ exists: false });

    await expect(
      performDownload('user-1', 'asset-1', 'https://api.example.test/assets/asset-1/content', TOKEN),
    ).resolves.toBe(`${ASSETS_DIR_URI}/user-1:asset-1`);

    expect(fsMock.__hasDirectory(ASSETS_DIR_URI)).toBe(true);
    expect(File.downloadFileAsync).toHaveBeenCalledTimes(1);
  });

  it('B. two first downloads that both saw a missing directory both succeed', async () => {
    // Stale check: every Paths.info call still reports "missing", so both downloads create.
    (Paths.info as jest.Mock).mockReturnValue({ exists: false });

    const [first, second] = await Promise.all([
      getOrStartAssetDownload('user-1', 'asset-1', '/assets/asset-1/content', async () => TOKEN),
      getOrStartAssetDownload('user-1', 'asset-2', '/assets/asset-2/content', async () => TOKEN),
    ]);

    expect(first).toBe(`${ASSETS_DIR_URI}/user-1:asset-1`);
    expect(second).toBe(`${ASSETS_DIR_URI}/user-1:asset-2`);
    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(File.downloadFileAsync).toHaveBeenCalledTimes(2);
  });

  it('C. does not create the directory when it already exists', async () => {
    (Paths.info as jest.Mock).mockImplementation((uri: string) =>
      uri === ASSETS_DIR_URI ? { exists: true, isDirectory: true } : { exists: false },
    );

    await performDownload('user-1', 'asset-1', 'https://api.example.test/assets/asset-1/content', TOKEN);

    expect(createSpy).not.toHaveBeenCalled();
    expect(File.downloadFileAsync).toHaveBeenCalledTimes(1);
  });

  it('D. mock guard: createDirectory rejects an empty child name like Android does', () => {
    const cacheDir = new Directory(Paths.cache, 'assets');

    expect(() => cacheDir.createDirectory('')).toThrow('child name must be a single path segment');
    expect(() => cacheDir.createDirectory('a/b')).toThrow('child name must be a single path segment');
    expect(() => cacheDir.create()).not.toThrow();
    expect(() => cacheDir.create()).toThrow('it already exists');
    expect(() => cacheDir.create({ idempotent: true })).not.toThrow();
  });
});
