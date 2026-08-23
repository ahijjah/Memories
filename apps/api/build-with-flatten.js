const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const distPath = path.join(__dirname, 'dist');
const appsSrcPath = path.join(distPath, 'apps', 'api', 'src');

// Build with NestJS
execSync('npx nest build', { stdio: 'inherit', cwd: __dirname });

// Flatten the output: recursively move src files to root of dist
if (fs.existsSync(appsSrcPath)) {
  const walkDir = (dir, baseTarget) => {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
      const srcFile = path.join(dir, file);
      const targetFile = path.join(baseTarget, file);
      const stats = fs.statSync(srcFile);
      if (stats.isDirectory()) {
        fs.mkdirSync(targetFile, { recursive: true });
        walkDir(srcFile, targetFile);
      } else if (stats.isFile()) {
        fs.cpSync(srcFile, targetFile);
      }
    });
  };

  walkDir(appsSrcPath, distPath);

  // Remove the nested structure
  fs.rmSync(path.join(distPath, 'apps'), { recursive: true });
  fs.rmSync(path.join(distPath, 'packages'), { recursive: true });
}
