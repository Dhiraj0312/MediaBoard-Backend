#!/usr/bin/env node

/**
 * Emergency script to restart backend with rate limiting disabled
 */

const { spawn } = require('child_process');

console.log('🚨 EMERGENCY: Restarting backend with rate limiting disabled...');

// Start the backend with rate limiting disabled
console.log('🚀 Starting backend with rate limiting disabled...');

const backend = spawn('npm', ['run', 'dev'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    DISABLE_RATE_LIMITING: 'true'
  }
});

backend.on('error', (error) => {
  console.error('❌ Failed to start backend:', error);
  process.exit(1);
});

backend.on('close', (code) => {
  console.log(`Backend process exited with code ${code}`);
  process.exit(code);
});

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down backend...');
  backend.kill('SIGINT');
});

console.log('✅ Backend starting with rate limiting disabled');
console.log('📝 Check the backend logs above for confirmation');
console.log('🌐 Frontend should now work without 429 errors');