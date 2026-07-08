const { spawn, spawnSync } = require('child_process');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const BACKEND_PORT = process.env.BACKEND_PORT || '4000';
const children = [];

function spawnLogged(name, args, env = {}) {
  const child = spawn('npm', args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    windowsHide: false
  });

  child.stdout.on('data', (data) => process.stdout.write(`[${name}] ${data}`));
  child.stderr.on('data', (data) => process.stderr.write(`[${name}] ${data}`));
  child.on('exit', (code, signal) => {
    console.log(`[${name}] exited code=${code} signal=${signal}`);
  });

  children.push(child);
  return child;
}

function electronEnv(instanceName) {
  return {
    BACKEND_PORT,
    MEETSUMMARIZER_LOCAL_BACKEND: '1',
    ELECTRON_USER_DATA_DIR: path.join(os.tmpdir(), `summarizeapp-${instanceName}`)
  };
}

function shutdown() {
  console.log('\nStopping dev processes...');
  for (const child of children.reverse()) {
    if (!child.killed) child.kill();
  }
}

process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});
process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

const build = spawnSync('npm', ['run', 'build:renderer'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: true,
  windowsHide: false
});

if (build.status !== 0) {
  process.exit(build.status || 1);
}

console.log(`Starting two Electron instances with shared local backend port ${BACKEND_PORT}`);
spawnLogged('electron-1', ['--prefix', 'desktop', 'start'], electronEnv('1'));
setTimeout(() => {
  spawnLogged('electron-2', ['--prefix', 'desktop', 'start'], electronEnv('2'));
}, 1500);
