#!/usr/bin/env node
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const isWin = process.platform === 'win32';

let bunCmd = 'bun';
if (isWin) {
  const localBun = join(homedir(), '.bun', 'bin', 'bun.exe');
  if (existsSync(localBun)) {
    bunCmd = localBun;
  }
}

console.log(`
=======================================================
  🚀 AsteAI Development Servers Starting
  
  💻 Web UI (App):    http://localhost:3000  <- OPEN THIS IN BROWSER
  📡 API Docs:        http://localhost:3001/api/docs
  ⚙️  API Endpoint:    http://localhost:3001/api/v1
=======================================================
`);

const api = spawn(bunCmd, ['run', '--filter', '@asteai/api', 'dev'], {
  stdio: 'inherit',
  shell: isWin,
});

const web = spawn(bunCmd, ['run', '--filter', '@asteai/web', 'dev'], {
  stdio: 'inherit',
  shell: isWin,
});

function cleanup() {
  console.log('\nShutting down dev servers...');
  try { api.kill(); } catch {}
  try { web.kill(); } catch {}
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

api.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`API process exited with code ${code}`);
  }
});

web.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`Web process exited with code ${code}`);
  }
});
