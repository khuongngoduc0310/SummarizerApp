const { spawn, spawnSync } = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const build = spawnSync('npm', ['run', 'build:renderer'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: true,
  windowsHide: false
});

if (build.status !== 0) {
  process.exit(build.status || 1);
}

const child = spawn('npm', ['--prefix', 'desktop', 'run', 'dev'], {
  cwd: repoRoot,
  env: {
    ...process.env,
    MEETSUMMARIZER_LOCAL_BACKEND: '1'
  },
  stdio: 'inherit',
  shell: true,
  windowsHide: false
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code || 0);
});
