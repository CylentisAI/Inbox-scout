const express = require('express');
const app = express();

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

const port = process.env.PORT || process.env.AGENT_SERVICE_PORT || 3000;
const host = '0.0.0.0';

app.listen(port, host, () => {
  console.log(`🚀 Test server running on ${host}:${port}`);
  console.log(`🏥 Health check: http://${host}:${port}/health`);
});
