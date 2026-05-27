// We use the global fetch directly since Node v18+ exposes it globally.

const TOKEN = 'lkr_801b90d5b1a14efe9ef56252b6269cea';
const BASE_URL = 'http://localhost:8787/api/mcp';

async function sendMcpRequest(method, params) {
  const body = {
    jsonrpc: '2.0',
    id: Date.now(),
    method,
    params
  };

  console.log(`\n>>> Sending Request (${method}):`, JSON.stringify(body, null, 2));

  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`
    },
    body: JSON.stringify(body)
  });

  console.log(`<<< Response Status:`, res.status);
  const text = await res.text();
  console.log(`<<< Response Text:`, text);
  try {
    const data = JSON.parse(text);
    return data;
  } catch (err) {
    console.error('Failed to parse response as JSON');
    return null;
  }
}

async function run() {
  try {
    // 1. Test tools/list
    console.log('--- Testing tools/list ---');
    await sendMcpRequest('tools/list', {});

  } catch (err) {
    console.error('Test execution failed:', err);
  }
}

run();
