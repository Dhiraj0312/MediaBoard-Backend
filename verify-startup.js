#!/usr/bin/env node

/**
 * Backend Startup Verification Script
 * 
 * This script checks if the backend server is running and optionally starts it.
 * It verifies connectivity and provides clear error messages for troubleshooting.
 */

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.PORT || 3001;
const HOST = 'localhost';
const HEALTH_ENDPOINT = '/health';
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

console.log('='.repeat(60));
console.log('🔍 Backend Server Verification');
console.log('='.repeat(60));
console.log('');

/**
 * Check if the backend server is running
 */
function checkServerHealth() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: HOST,
      port: PORT,
      path: HEALTH_ENDPOINT,
      method: 'GET',
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const health = JSON.parse(data);
          resolve({ success: true, health, statusCode: res.statusCode });
        } catch (error) {
          reject(new Error(`Invalid health response: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Health check request timed out'));
    });

    req.end();
  });
}

/**
 * Start the backend server
 */
function startBackendServer() {
  return new Promise((resolve, reject) => {
    console.log('🚀 Starting backend server...');
    console.log('');

    const isWindows = process.platform === 'win32';
    const npmCommand = isWindows ? 'npm.cmd' : 'npm';
    
    const serverProcess = spawn(npmCommand, ['run', 'dev'], {
      cwd: path.join(__dirname),
      stdio: 'inherit',
      shell: true,
      detached: !isWindows
    });

    serverProcess.on('error', (error) => {
      reject(new Error(`Failed to start server: ${error.message}`));
    });

    // Give the server time to start
    setTimeout(() => {
      resolve(serverProcess);
    }, 5000);
  });
}

/**
 * Display health status
 */
function displayHealthStatus(health) {
  console.log('✅ Backend server is running');
  console.log('');
  console.log('📊 Health Status:');
  console.log(`   Status: ${health.status}`);
  console.log(`   Service: ${health.service}`);
  console.log(`   Version: ${health.version}`);
  console.log(`   Environment: ${health.environment}`);
  console.log(`   Uptime: ${Math.floor(health.uptime)}s`);
  console.log(`   Database: ${health.database}`);
  console.log(`   Supabase: ${health.supabase}`);
  console.log('');
  console.log(`🌐 Server URL: http://${HOST}:${PORT}`);
  console.log(`📡 Health Check: http://${HOST}:${PORT}${HEALTH_ENDPOINT}`);
  
  if (health.status === 'DEGRADED') {
    console.log('');
    console.log('⚠️  Warning: Server is running but some services are degraded');
    if (health.databaseError) {
      console.log(`   Database Error: ${health.databaseError}`);
    }
    if (health.supabaseError) {
      console.log(`   Supabase Error: ${health.supabaseError}`);
    }
  }
}

/**
 * Display error and troubleshooting steps
 */
function displayError(error) {
  console.error('❌ Backend server is not running');
  console.error('');
  console.error('Error Details:');
  console.error(`   ${error.message}`);
  console.error('');
  console.error('📋 Troubleshooting Steps:');
  console.error('');
  console.error('1. Start the backend server manually:');
  console.error('   cd backend');
  console.error('   npm run dev');
  console.error('');
  console.error('2. Check if another process is using port 3001:');
  if (process.platform === 'win32') {
    console.error('   netstat -ano | findstr :3001');
  } else {
    console.error('   lsof -i :3001');
  }
  console.error('');
  console.error('3. Verify your .env file contains:');
  console.error('   SUPABASE_URL=your_supabase_url');
  console.error('   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key');
  console.error('');
  console.error('4. Check backend logs for errors:');
  console.error('   Look for error messages in the terminal where you started the server');
  console.error('');
}

/**
 * Main verification function
 */
async function verifyBackend(autoStart = false) {
  let retries = 0;

  while (retries < MAX_RETRIES) {
    try {
      console.log(`🔍 Checking backend server (attempt ${retries + 1}/${MAX_RETRIES})...`);
      
      const { health, statusCode } = await checkServerHealth();
      
      console.log('');
      displayHealthStatus(health);
      console.log('');
      console.log('='.repeat(60));
      console.log('✅ Verification Complete');
      console.log('='.repeat(60));
      
      return true;
    } catch (error) {
      retries++;
      
      if (retries < MAX_RETRIES) {
        console.log(`⏳ Retrying in ${RETRY_DELAY / 1000} seconds...`);
        console.log('');
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      } else {
        console.log('');
        displayError(error);
        
        if (autoStart) {
          console.log('');
          console.log('🔄 Attempting to start backend server automatically...');
          console.log('');
          
          try {
            await startBackendServer();
            console.log('');
            console.log('✅ Backend server started successfully');
            console.log('   Please wait a few seconds for initialization to complete');
            console.log('');
            console.log('💡 Tip: Run this script again to verify the server is healthy');
            return true;
          } catch (startError) {
            console.error('');
            console.error('❌ Failed to start backend server automatically');
            console.error(`   Error: ${startError.message}`);
            console.error('');
            console.error('   Please start the server manually using the steps above');
          }
        }
        
        console.log('');
        console.log('='.repeat(60));
        console.log('❌ Verification Failed');
        console.log('='.repeat(60));
        
        return false;
      }
    }
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const autoStart = args.includes('--start') || args.includes('-s');

if (args.includes('--help') || args.includes('-h')) {
  console.log('Backend Server Verification Script');
  console.log('');
  console.log('Usage:');
  console.log('  node verify-startup.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --start, -s    Automatically start the server if not running');
  console.log('  --help, -h     Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  node verify-startup.js           # Check if server is running');
  console.log('  node verify-startup.js --start   # Check and start if needed');
  console.log('');
  process.exit(0);
}

// Run verification
verifyBackend(autoStart).then((success) => {
  process.exit(success ? 0 : 1);
}).catch((error) => {
  console.error('');
  console.error('❌ Unexpected error during verification:');
  console.error(error);
  console.error('');
  process.exit(1);
});
