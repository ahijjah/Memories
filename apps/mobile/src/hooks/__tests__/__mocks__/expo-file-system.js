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

class Directory {
  constructor(path, name) {
    this.path = path;
    this.name = name;
    // Construct URI: if path is a Directory object with uri, use it; otherwise use string path
    const pathUri = typeof path === 'object' && path.uri ? path.uri : String(path);
    this.uri = name ? `${pathUri}/${name}` : pathUri;
  }

  createDirectory(name) {
    return new Directory(this.uri, name);
  }
}

const Paths = {
  cache: 'cache',
  info: jest.fn(),
};

module.exports = {
  File,
  Directory,
  Paths,
};
