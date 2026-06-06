import { execSync } from 'node:child_process';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import crypto from 'node:crypto';

// Import unit-testable modules directly
import { shannonEntropy, maskSensitiveData, containsSensitiveData } from '../src/server/dlp';
import { EphemeralPlaintext, hashToken, verifyToken, sha256Hex } from '../src/server/crypto';

const BASE_URL = 'http://localhost:8788/api/mcp';
const DB_NAME = 'locker-db';
const CONFIG_PATH = 'dist/server/wrangler.json';
const TEST_USER_ID = 'VccpgcmaIPl0Ddu0zxZc7jmLGFKHhODJ';

async function sendMcpRequest(token: string, method: string, params: any) {
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
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error('Non-JSON response:', text);
    throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`);
  }
}

function runDbCommand(sql: string) {
  const tempSqlFile = path.resolve('scratch/temp-test.sql');
  fs.writeFileSync(tempSqlFile, sql, 'utf8');
  try {
    const output = execSync(
      `npx wrangler d1 execute ${DB_NAME} --local --config ${CONFIG_PATH} --file "${tempSqlFile}" --json`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
    );
    return JSON.parse(output);
  } catch (err: any) {
    console.error(`DB Query failed: ${sql}`);
    throw err;
  } finally {
    try {
      if (fs.existsSync(tempSqlFile)) {
        fs.unlinkSync(tempSqlFile);
      }
    } catch (e) {}
  }
}

async function run() {
  console.log('====================================================');
  console.log('   LOCKER CORE FEATURE COMPREHENSIVE TEST SUITE     ');
  console.log('====================================================\n');

  const checklist: { name: string; status: 'PASSED' | 'FAILED' }[] = [];
  const logTestResult = (name: string, fn: () => Promise<void> | void) => {
    console.log(`\n👉 Running: ${name}...`);
    try {
      fn();
      console.log(`✅ Passed: ${name}`);
      checklist.push({ name, status: 'PASSED' });
    } catch (err: any) {
      console.error(`❌ Failed: ${name}`);
      console.error(err);
      checklist.push({ name, status: 'FAILED' });
    }
  };

  const logAsyncTestResult = async (name: string, fn: () => Promise<void>) => {
    console.log(`\n👉 Running: ${name}...`);
    try {
      await fn();
      console.log(`✅ Passed: ${name}`);
      checklist.push({ name, status: 'PASSED' });
    } catch (err: any) {
      console.error(`❌ Failed: ${name}`);
      console.error(err);
      checklist.push({ name, status: 'FAILED' });
    }
  };

  // ---------------------------------------------------------------------------
  // PART 1: Cryptography & DLP Unit Tests
  // ---------------------------------------------------------------------------

  logTestResult('Unit - Shannon Entropy Secret Detection', () => {
    const lowEntropy = 'myproject-api-v2';
    // Use a high-entropy base64 string
    const highEntropy = '6fUxHNEdxi6kDTOgUh5nz-jdyi0RLdkriYBdk6GL0Sw';
    const entropyLow = shannonEntropy(lowEntropy);
    const entropyHigh = shannonEntropy(highEntropy);
    
    console.log(`  Entropy of "${lowEntropy}": ${entropyLow.toFixed(2)}`);
    console.log(`  Entropy of "${highEntropy}": ${entropyHigh.toFixed(2)}`);
    
    assert.ok(entropyLow < 4.0);
    assert.ok(entropyHigh >= 4.0);
  });

  logTestResult('Unit - DLP Sensitive Data Masking', () => {
    const rawText = 'Contact me at user@example.com or use sk_test_51NzABCDeFgHiJkLmNoPqRsTuVwXyZ12345';
    const masked = maskSensitiveData(rawText);
    
    console.log(`  Raw:    "${rawText}"`);
    console.log(`  Masked: "${masked}"`);
    
    assert.ok(masked.includes('[REDACTED_EMAIL]'));
    assert.ok(masked.includes('[REDACTED_STRIPE_KEY]'));
    assert.ok(!masked.includes('user@example.com'));
    assert.ok(!masked.includes('sk_test_'));
    
    assert.ok(containsSensitiveData(rawText));
    assert.ok(!containsSensitiveData('This is clean text with no PII.'));
  });

  logTestResult('Unit - Ephemeral Compute Plaintext Pipeline', () => {
    const textBytes = new TextEncoder().encode('confidential data');
    const pipeline = new EphemeralPlaintext(textBytes);
    
    assert.strictEqual(pipeline.get(), 'confidential data');
    
    pipeline.drop();
    
    assert.throws(() => {
      pipeline.get();
    }, /Plaintext has already been dropped/);
  });

  await logAsyncTestResult('Unit - PBKDF2 Token Secure Hashing', async () => {
    const token = 'lkr_test_token_1234567890';
    const hash = await hashToken(token);
    
    console.log(`  Generated PBKDF2 hash: ${hash}`);
    assert.ok(hash.startsWith('pbkdf2$100000$'));
    
    const isMatched = await verifyToken(token, hash);
    assert.strictEqual(isMatched, true);
    
    const isMismatched = await verifyToken('wrong_token', hash);
    assert.strictEqual(isMismatched, false);

    // Verify fallback to legacy SHA-256 tokens
    const legacySecret = 'legacy_secret_token';
    const legacyHash = await sha256Hex(legacySecret);
    console.log(`  Legacy hash: ${legacyHash}`);
    
    const isLegacyMatched = await verifyToken(legacySecret, legacyHash);
    assert.strictEqual(isLegacyMatched, true);
  });

  // ---------------------------------------------------------------------------
  // PART 2: Database Initialization & Token Generation
  // ---------------------------------------------------------------------------

  console.log('\n--- Initializing local test database schema & tokens ---');
  
  // Create test user if not exists
  runDbCommand(`INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) 
    VALUES ('${TEST_USER_ID}', 'Roger', 'rogerleecormier@gmail.com', 0, ${Date.now()}, ${Date.now()})
    ON CONFLICT(id) DO NOTHING;`);

  // Clear existing test memories/tokens
  runDbCommand(`DELETE FROM api_tokens WHERE userId = '${TEST_USER_ID}';`);
  runDbCommand(`DELETE FROM memories WHERE userId = '${TEST_USER_ID}';`);
  runDbCommand(`DELETE FROM jit_access_requests WHERE userId = '${TEST_USER_ID}';`);
  runDbCommand(`DELETE FROM memory_graph_nodes WHERE userId = '${TEST_USER_ID}';`);

  // 1. Human Token
  const humanId = crypto.randomUUID();
  const humanSecret = crypto.randomBytes(16).toString('hex');
  const humanToken = `lkr_${humanId.replace(/-/g, '')}_${humanSecret}`;
  const humanHash = await hashToken(humanToken);
  runDbCommand(`INSERT INTO api_tokens (id, userId, name, tokenHash, permissions, createdAt, tokenType) 
    VALUES ('${humanId}', '${TEST_USER_ID}', 'Test Human Token', '${humanHash}', 15, ${Date.now()}, 'human');`);
  
  // 2. Agent Token (with agent policy restricting access to #confidential tags)
  const agentId = crypto.randomUUID();
  const agentSecret = crypto.randomBytes(16).toString('hex');
  const agentToken = `lkr_${agentId.replace(/-/g, '')}_${agentSecret}`;
  const agentHash = await hashToken(agentToken);
  const agentPolicy = JSON.stringify({
    agentContext: 'TestAgentSuite',
    allowedCategories: ['rules', 'projects', 'references', 'stack'],
    deniedCategories: [],
    allowedTags: [],
    deniedTags: [], // Empty allowedTags/deniedTags triggers JIT for #confidential
    allowCredentials: false
  });
  runDbCommand(`INSERT INTO api_tokens (id, userId, name, tokenHash, permissions, createdAt, tokenType, agentPolicy) 
    VALUES ('${agentId}', '${TEST_USER_ID}', 'Test Agent Token', '${agentHash}', 3, ${Date.now()}, 'agent', '${agentPolicy}');`);

  console.log('  Human Token:', humanToken);
  console.log('  Agent Token:', agentToken);

  // ---------------------------------------------------------------------------
  // PART 3: Endpoint Integration Tests
  // ---------------------------------------------------------------------------

  await logAsyncTestResult('Integration - Non-Destructive DLP Quarantine', async () => {
    // Commit a memory with Stripe Key (sensitive)
    const sensitiveFact = 'Stripe webhook secret sk_test_51NzABCDeFgHiJkLmNoPqRsTuVwXyZ12345';
    const commitRes = await sendMcpRequest(humanToken, 'tools/call', {
      name: 'commit_memory',
      arguments: {
        fact: sensitiveFact,
        category: 'references',
        tags: 'stripe, webhook'
      }
    });

    const result = JSON.parse(commitRes.result.content[0].text);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.fact, '[REDACTED]');
    const memoryId = result.id;

    // Verify it is flagged isQuarantined = 1 in the D1 database
    const dbRows = runDbCommand(`SELECT isQuarantined FROM memories WHERE id = '${memoryId}';`);
    assert.strictEqual(dbRows[0].results[0].isQuarantined, 1);

    // Call search_memories, verify fact is redacted
    const searchRes = await sendMcpRequest(humanToken, 'tools/call', {
      name: 'search_memories',
      arguments: { limit: 5 }
    });
    const searchResults = JSON.parse(searchRes.result.content[0].text).results;
    const item = searchResults.find((m: any) => m.id === memoryId);
    assert.ok(item);
    assert.strictEqual(item.fact, '[REDACTED]');

    // Manually unquarantine in D1 (simulating human approval)
    runDbCommand(`UPDATE memories SET isQuarantined = 0 WHERE id = '${memoryId}';`);

    // Call search_memories again, verify it is now unmasked
    const searchRes2 = await sendMcpRequest(humanToken, 'tools/call', {
      name: 'search_memories',
      arguments: { limit: 5 }
    });
    const searchResults2 = JSON.parse(searchRes2.result.content[0].text).results;
    const item2 = searchResults2.find((m: any) => m.id === memoryId);
    assert.ok(item2);
    assert.strictEqual(item2.fact, sensitiveFact);
  });

  await logAsyncTestResult('Integration - Tag-Level ABAC & JIT Context Escalation', async () => {
    // Commit confidential memory using Human token
    const confidentialFact = 'The database production password is super-secret-password-999';
    const commitRes = await sendMcpRequest(humanToken, 'tools/call', {
      name: 'commit_memory',
      arguments: {
        fact: confidentialFact,
        category: 'references',
        tags: 'database, #confidential'
      }
    });
    const result = JSON.parse(commitRes.result.content[0].text);
    const memoryId = result.id;

    // Call recall_context using Agent token. Verify JIT is triggered.
    const recallRes = await sendMcpRequest(agentToken, 'tools/call', {
      name: 'recall_context',
      arguments: { query: 'database production password' }
    });
    const recallData = JSON.parse(recallRes.result.content[0].text);
    console.log('  Agent Recall Response:', recallData);
    
    assert.ok(recallData.jit, 'Should contain JIT request details');
    assert.strictEqual(recallData.results[0].fact, '[APPROVAL PENDING]');
    const jitRequestId = recallData.jit.jitRequestId;

    // Approve the JIT request using Human token
    const approveRes = await sendMcpRequest(humanToken, 'tools/call', {
      name: 'approve_jit_access',
      arguments: {
        jitRequestId,
        decision: 'approve',
        reviewNotes: 'Approved for testing'
      }
    });
    const approveData = JSON.parse(approveRes.result.content[0].text);
    console.log('  JIT Approval Response:', approveData);
    assert.strictEqual(approveData.success, true);
    assert.strictEqual(approveData.decision, 'approve');
    const jitToken = approveData.jitToken;
    assert.ok(jitToken.startsWith('lkr_jit_'));

    // Re-run recall_context using JIT token as Bearer token
    const recallResJit = await sendMcpRequest(jitToken, 'tools/call', {
      name: 'recall_context',
      arguments: { query: 'database production password' }
    });
    const recallDataJit = JSON.parse(recallResJit.result.content[0].text);
    console.log('  JIT Token Recall Response:', recallDataJit);
    assert.strictEqual(recallDataJit.results[0].fact, confidentialFact);

    // Verify Agent cannot approve JIT requests
    const rejectRes = await sendMcpRequest(agentToken, 'tools/call', {
      name: 'approve_jit_access',
      arguments: {
        jitRequestId,
        decision: 'approve'
      }
    });
    assert.ok(rejectRes.error);
    assert.strictEqual(rejectRes.error.code, -32003);
    assert.ok(rejectRes.error.message.includes('Forbidden'));
  });

  await logAsyncTestResult('Integration - Edge-Native GraphRAG Topology', async () => {
    // Commit service relationship memories
    await sendMcpRequest(humanToken, 'tools/call', {
      name: 'commit_memory',
      arguments: {
        fact: 'PaymentGateway calls AuthAPI for authentication',
        category: 'projects',
        tags: 'payment, auth'
      }
    });

    // Check memoryGraphNodes and memoryGraphEdges tables
    const nodeRows = runDbCommand(`SELECT * FROM memory_graph_nodes WHERE userId = '${TEST_USER_ID}';`);
    const edgeRows = runDbCommand(`SELECT * FROM memory_graph_edges;`);
    
    console.log(`  Graph Nodes Created: ${nodeRows[0].results.map((n: any) => n.label).join(', ')}`);
    console.log(`  Graph Edges Created count: ${edgeRows[0].results.length}`);
    
    assert.ok(nodeRows[0].results.length >= 2, 'Should have nodes for PaymentGateway and AuthAPI');
    assert.ok(edgeRows[0].results.length >= 1, 'Should have edge representing the relationship');
  });

  await logAsyncTestResult('Integration - Dynamic Prompt Packing (Context Optimization)', async () => {
    // Commit two related stack memories
    await sendMcpRequest(humanToken, 'tools/call', {
      name: 'commit_memory',
      arguments: {
        fact: 'Locker is written in React 19',
        category: 'rules',
        tags: 'frontend'
      }
    });
    await sendMcpRequest(humanToken, 'tools/call', {
      name: 'commit_memory',
      arguments: {
        fact: 'Locker frontend uses TanStack Router for navigation',
        category: 'rules',
        tags: 'frontend, router'
      }
    });

    // Recall with optimize: true
    const optimizeRes = await sendMcpRequest(humanToken, 'tools/call', {
      name: 'recall_context',
      arguments: {
        query: 'Locker frontend stack',
        optimize: true
      }
    });

    const optimizeData = JSON.parse(optimizeRes.result.content[0].text);
    console.log('  Optimized Prompt Output:\n', optimizeData.optimized_prompt);
    
    assert.ok(optimizeData.optimized_prompt);
    assert.ok(optimizeData.optimized_prompt.includes('React 19') || optimizeData.optimized_prompt.includes('TanStack Router'));
  });

  // ---------------------------------------------------------------------------
  // CLEANUP & REPORT
  // ---------------------------------------------------------------------------
  console.log('\n--- Cleaning up test records ---');
  runDbCommand(`DELETE FROM api_tokens WHERE userId = '${TEST_USER_ID}';`);
  runDbCommand(`DELETE FROM memories WHERE userId = '${TEST_USER_ID}';`);
  runDbCommand(`DELETE FROM jit_access_requests WHERE userId = '${TEST_USER_ID}';`);
  runDbCommand(`DELETE FROM memory_graph_nodes WHERE userId = '${TEST_USER_ID}';`);
  console.log('  Cleaned up all test tokens and database records.');

  console.log('\n====================================================');
  console.log('                 TEST RUN REPORT                    ');
  console.log('====================================================');
  for (const item of checklist) {
    const icon = item.status === 'PASSED' ? '✅' : '❌';
    console.log(`${icon}  ${item.name.padEnd(50)} [${item.status}]`);
  }
  console.log('====================================================\n');

  const failedCount = checklist.filter((item) => item.status === 'FAILED').length;
  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('Test Suite crashed:', err);
  process.exit(1);
});
