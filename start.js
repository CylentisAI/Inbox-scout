#!/usr/bin/env node

console.log('================================');
console.log('Starting InboxScout Agent...');
console.log('================================');
console.log('Node version:', process.version);
console.log('Working directory:', process.cwd());
console.log('PORT from Railway:', process.env.PORT);
console.log('================================');

// Check environment variables
const requiredEnvVars = [
  'OPENAI_API_KEY',
  'PINECONE_API_KEY', 
  'PINECONE_ENVIRONMENT',
  'PINECONE_INDEX_NAME'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ MISSING REQUIRED ENVIRONMENT VARIABLES:');
  console.error('   ', missingVars.join(', '));
  console.error('');
  console.error('Current environment variables (keys only):');
  console.error('   ', Object.keys(process.env).sort().join(', '));
  console.error('');
  console.error('⚠️  STARTING IN LIMITED MODE FOR DEBUGGING');
  console.error('    Set all required env vars in Railway dashboard');
  console.error('');
  
  // Start a minimal health check server for debugging
  const express = require('express');
  const app = express();
  const port = parseInt(process.env.PORT || '3000');
  
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'degraded',
      error: 'Missing environment variables',
      missing: missingVars,
      message: 'Set environment variables in Railway dashboard'
    });
  });
  
  app.get('/', (req, res) => {
    res.json({
      error: 'Service not configured',
      missing_vars: missingVars,
      instructions: 'Add the following environment variables in Railway dashboard: ' + missingVars.join(', ')
    });
  });
  
  app.listen(port, '0.0.0.0', () => {
    console.log(`🔧 Debug server running on port ${port}`);
    console.log(`   Health check available at /health`);
    console.log(`   Add missing env vars to start full service`);
  });
  
} else {
  console.log('✅ All required environment variables present');
  console.log('Starting full application...');
  console.log('');
  
  // Load the actual application
  require('./packages/agent-service/dist/index.js');
}
