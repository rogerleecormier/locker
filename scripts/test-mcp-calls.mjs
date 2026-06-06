import { argv } from 'node:process';

const TOKEN = 'lkr_39b49e8efc634bef9ce117c82680d960_36a9f103ee69f33f923a31021b90a859';
const BASE_URL = 'http://localhost:8787/api/mcp';

async function sendMcpRequest(method, params) {
  const body = {
    jsonrpc: '2.0',
    id: Date.now(),
    method,
    params
  };

  console.log(`\n>>> Request (${method}):`, JSON.stringify(params, null, 2));

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
  try {
    const data = JSON.parse(text);
    console.log(`<<< Response Body:`, JSON.stringify(data, null, 2));
    return data;
  } catch (err) {
    console.log(`<<< Response Text (non-JSON):`, text);
    return null;
  }
}

async function run() {
  try {
    // 1. List tools
    console.log('\n======================================');
    console.log('1. Testing tools/list');
    console.log('======================================');
    await sendMcpRequest('tools/list', {});

    // 2. Commit memories
    console.log('\n======================================');
    console.log('2. Committing Test Memories');
    console.log('======================================');
    await sendMcpRequest('tools/call', {
      name: 'commit_memory',
      arguments: {
        fact: 'Never run python commands in the root directory',
        category: 'rules',
        tags: 'development, python'
      }
    });

    await sendMcpRequest('tools/call', {
      name: 'commit_memory',
      arguments: {
        fact: 'Project Apollo is using React and Vite',
        category: 'projects',
        tags: 'apollo, frontend, react'
      }
    });

    await sendMcpRequest('tools/call', {
      name: 'commit_memory',
      arguments: {
        fact: 'D1 database connection timeout is 5000ms',
        category: 'references',
        tags: 'd1, cloudflare, database'
      }
    });

    // 3. Get memory summary
    console.log('\n======================================');
    console.log('3. Testing get_memory_summary');
    console.log('======================================');
    await sendMcpRequest('tools/call', {
      name: 'get_memory_summary',
      arguments: {}
    });

    // 4. Search memories (category filter)
    console.log('\n======================================');
    console.log('4. Testing search_memories (category=rules)');
    console.log('======================================');
    await sendMcpRequest('tools/call', {
      name: 'search_memories',
      arguments: {
        category: 'rules'
      }
    });

    // 5. Search memories (tag filter)
    console.log('\n======================================');
    console.log('5. Testing search_memories (tag=react)');
    console.log('======================================');
    await sendMcpRequest('tools/call', {
      name: 'search_memories',
      arguments: {
        tag: 'react'
      }
    });

    // 6. Search memories (keyword filter)
    console.log('\n======================================');
    console.log('6. Testing search_memories (keyword=timeout)');
    console.log('======================================');
    await sendMcpRequest('tools/call', {
      name: 'search_memories',
      arguments: {
        keyword: 'timeout'
      }
    });

    // 7. Search memories (pagination)
    console.log('\n======================================');
    console.log('7. Testing search_memories (pagination: limit=2)');
    console.log('======================================');
    await sendMcpRequest('tools/call', {
      name: 'search_memories',
      arguments: {
        limit: 2
      }
    });

  } catch (err) {
    console.error('Test execution failed:', err);
  }
}

run();
