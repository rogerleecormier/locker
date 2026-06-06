import { execSync } from 'node:child_process';
import * as assert from 'node:assert';

const TOKEN = 'lkr_02b9b1b5400d484ba6d527b083d257a3_133516c136c0637264544c9656b08bb2';
const BASE_URL = 'http://localhost:8787/api/mcp';

async function sendMcpRequest(method: string, params: any) {
  const body = {
    jsonrpc: '2.0',
    id: Date.now(),
    method,
    params
  };

  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error('Non-JSON response:', text);
    throw err;
  }
}

async function runTests() {
  console.log('=== STARTING DLP QUARANTINE INTEGRATION TESTS ===');

  // Test 1: Commit memory with sensitive data (Stripe Key)
  console.log('\n--- Test 1: Committing sensitive memory ---');
  const sensitiveFact = 'Stripe keySk is sk_test_51NzABCDeFgHiJkLmNoPqRsTuVwXyZ12345';
  const commitRes1 = await sendMcpRequest('tools/call', {
    name: 'commit_memory',
    arguments: {
      fact: sensitiveFact,
      category: 'references',
      tags: 'stripe, test'
    }
  });

  console.log('Commit raw response:', JSON.stringify(commitRes1, null, 2));
  if (commitRes1.error) {
    throw new Error(`MCP Error: ${JSON.stringify(commitRes1.error)}`);
  }
  const result1 = JSON.parse(commitRes1.result.content[0].text);
  console.log('Commit Response:', result1);
  assert.strictEqual(result1.success, true);
  assert.strictEqual(result1.fact, '[REDACTED]');
  const sensitiveId = result1.id;
  console.log('Sensitive Memory ID:', sensitiveId);

  // Test 2: Commit normal memory
  console.log('\n--- Test 2: Committing normal memory ---');
  const normalFact = 'Deploy server to region us-east-1';
  const commitRes2 = await sendMcpRequest('tools/call', {
    name: 'commit_memory',
    arguments: {
      fact: normalFact,
      category: 'projects',
      tags: 'deploy'
    }
  });

  const result2 = JSON.parse(commitRes2.result.content[0].text);
  console.log('Commit Response:', result2);
  assert.strictEqual(result2.success, true);
  assert.strictEqual(result2.fact, normalFact);
  const normalId = result2.id;

  // Test 3: Search memories and check facts
  console.log('\n--- Test 3: Searching memories ---');
  const searchRes = await sendMcpRequest('tools/call', {
    name: 'search_memories',
    arguments: {
      limit: 10
    }
  });

  const searchItems = JSON.parse(searchRes.result.content[0].text);
  console.log('Search Results:', searchItems.map((item: any) => ({ id: item.id, fact: item.fact })));

  const sensitiveItem = searchItems.find((item: any) => item.id === sensitiveId);
  const normalItem = searchItems.find((item: any) => item.id === normalId);

  assert.ok(sensitiveItem, 'Sensitive item should be in search results');
  assert.strictEqual(sensitiveItem.fact, '[REDACTED]', 'Sensitive fact must be redacted');
  assert.ok(normalItem, 'Normal item should be in search results');
  assert.strictEqual(normalItem.fact, normalFact, 'Normal fact must not be redacted');

  // Test 4: Recall context and check facts
  console.log('\n--- Test 4: Recalling context ---');
  const recallRes = await sendMcpRequest('tools/call', {
    name: 'recall_context',
    arguments: {
      query: 'Stripe keySk deployment settings',
      topK: 5
    }
  });

  const recallItems = JSON.parse(recallRes.result.content[0].text);
  console.log('Recall Results:', recallItems.map((item: any) => ({ id: item.id, fact: item.fact })));

  const recalledSensitiveItem = recallItems.find((item: any) => item.id === sensitiveId);
  assert.ok(recalledSensitiveItem, 'Sensitive item should be recalled');
  assert.strictEqual(recalledSensitiveItem.fact, '[REDACTED]', 'Recalled sensitive fact must be redacted');

  // Test 5: Unmask the memory via local SQLite command (simulating human Locker UI review)
  console.log('\n--- Test 5: Unmasking memory in SQLite ---');
  const dbName = 'locker-db';
  const unmaskCommand = `UPDATE memories SET isQuarantined = 0 WHERE id = '${sensitiveId}';`;
  execSync(
    `npx wrangler d1 execute ${dbName} --local --config dist/server/wrangler.json --command "${unmaskCommand}"`,
    { encoding: 'utf8' }
  );
  console.log('Successfully set isQuarantined = 0 for ID:', sensitiveId);

  // Test 6: Search memories again after unmasking
  console.log('\n--- Test 6: Searching memories after unmasking ---');
  const searchRes2 = await sendMcpRequest('tools/call', {
    name: 'search_memories',
    arguments: {
      limit: 10
    }
  });

  const searchItems2 = JSON.parse(searchRes2.result.content[0].text);
  console.log('Search Results after unmasking:', searchItems2.map((item: any) => ({ id: item.id, fact: item.fact })));

  const sensitiveItem2 = searchItems2.find((item: any) => item.id === sensitiveId);
  assert.ok(sensitiveItem2, 'Sensitive item should still be in search results');
  assert.strictEqual(sensitiveItem2.fact, sensitiveFact, 'Sensitive fact must be unmasked/plaintext');

  console.log('\nALL DLP QUARANTINE INTEGRATION TESTS PASSED!');
}

runTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
