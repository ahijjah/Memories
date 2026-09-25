class File {
  constructor(directory, filename) {
    this.directory = directory;
    this.filename = filename;
    // Construct URI: if directory is a Directory object with uri, use it; otherwise use string path
    const dirUri = typeof directory === 'object' && directory.uri ? directory.uri : String(directory);
    this.uri = `${dirUri}/${filename}`;
  }

  static downloadFileAsync = jest.fn();
}

// Directories created through this mock. Paths.info stays a plain jest.fn(), so tests decide
// what "exists" reports; this state only drives create()/createDirectory() semantics.
const createdDirectories = new Set();

// Mirrors expo-file-system 57 Android validateFileSystemChildName: a child must be one segment.
function assertValidChildName(name) {
  if (
    typeof name !== 'string' ||
    name === '' ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\')
  ) {
    throw new Error('Unable to create file or directory: child name must be a single path segment');
  }
}

class Directory {
  constructor(path, name) {
    this.path = path;
    this.name = name;
    // Construct URI: if path is a Directory object with uri, use it; otherwise use string path
    const pathUri = typeof path === 'object' && path.uri ? path.uri : String(path);
    this.uri = name ? `${pathUri}/${name}` : pathUri;
  }

  // Creates this directory (v57 Directory.create). Fails if it already exists unless idempotent.
  create(options = {}) {
    if (createdDirectories.has(this.uri)) {
      if (options.idempotent) return;
      if (!options.overwrite) {
        throw new Error('Unable to create file or directory: it already exists');
      }
    }
    createdDirectories.add(this.uri);
  }

  // Creates a named child directory (v57 Directory.createDirectory).
  createDirectory(name) {
    assertValidChildName(name);
    const child = new Directory(this.uri, name);
    child.create();
    return child;
  }
}

const Paths = {
  cache: 'cache',
  info: jest.fn(),
};

function __resetDirectories() {
  createdDirectories.clear();
}

function __hasDirectory(uri) {
  return createdDirectories.has(uri);
}

module.exports = {
  File,
  Directory,
  Paths,
  __resetDirectories,
  __hasDirectory,
};
