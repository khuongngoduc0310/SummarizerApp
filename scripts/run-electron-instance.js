const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const instanceName = process.argv[2] || '1';
const BACKEND_PORT = process.env.BACKEND_PORT || '4000';
const ELECTRON_USER_DATA_DIR = path.join(os.tmpdir(), `summarizeapp-${instanceName}`);

const child = spawn('npm', ['--prefix', 'desktop', 'start'], {
  cwd: path.resolve(__dirname, '..'),
  env: {
    ...process.env,
    BACKEND_PORT,
    ELECTRON_USER_DATA_DIR,
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
