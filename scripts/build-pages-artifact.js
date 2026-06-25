import { buildPagesArtifact } from './pages-artifact.js';

try {
  buildPagesArtifact({
    rootDir: process.argv[2] ?? 'dist',
    projectRoot: process.cwd(),
  });
  console.log('Built shallow GitHub Pages artifact paths.');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
