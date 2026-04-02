import path from 'node:path';

const projectDir = '/Users/jeremydossantos/Desktop/Agency & Freelance/EDITOR-BASE';
process.chdir(projectDir);
process.argv = [process.argv[0], process.argv[1], '--port=5174', '--host=0.0.0.0'];

const viteCli = path.join(projectDir, 'node_modules/vite/dist/node/cli.js');
await import(viteCli);
