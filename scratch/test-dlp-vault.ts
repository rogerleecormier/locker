import { maskSensitiveData } from "../src/server/dlp";
import { encrypt, decrypt, deriveUserKey } from "../src/server/crypto";
import * as assert from "assert";

async function runTests() {
  console.log("=== Running DLP Active Masking Tests ===");

  const emailText = "Contact me at test.user@example.com or another.email+spam@domain.co.uk";
  const maskedEmail = maskSensitiveData(emailText);
  console.log("Original:", emailText);
  console.log("Masked:  ", maskedEmail);
  assert.ok(maskedEmail.includes("[REDACTED_EMAIL]"));
  assert.ok(!maskedEmail.includes("test.user@example.com"));

  const phoneText = "My phone number is +1 (555) 019-2834, call me!";
  const maskedPhone = maskSensitiveData(phoneText);
  console.log("Original:", phoneText);
  console.log("Masked:  ", maskedPhone);
  assert.ok(maskedPhone.includes("[REDACTED_PHONE_NUMBER]"));

  const credentialsText = "I have stripes: sk_test_51NzABCDeFgHiJkLmNoPqRsTuVwXyZ12345 and github ghp_1234567890abcdef1234567890abcdef12345678";
  const maskedCreds = maskSensitiveData(credentialsText);
  console.log("Original:", credentialsText);
  console.log("Masked:  ", maskedCreds);
  assert.ok(maskedCreds.includes("[REDACTED_STRIPE_KEY]"));
  assert.ok(maskedCreds.includes("[REDACTED_GITHUB_TOKEN]"));

  const slackText = "Slack: xoxb-mocktokenvaluevaluevalue";
  const maskedSlack = maskSensitiveData(slackText);
  console.log("Original:", slackText);
  console.log("Masked:  ", maskedSlack);
  assert.ok(maskedSlack.includes("[REDACTED_SLACK_TOKEN]"));

  const dbUriText = "Use postgres://user:password123@db-host.rds.amazonaws.com:5432/my_database";
  const maskedDbUri = maskSensitiveData(dbUriText);
  console.log("Original:", dbUriText);
  console.log("Masked:  ", maskedDbUri);
  assert.ok(maskedDbUri.includes("[REDACTED_CONNECTION_STRING]"));

  const privateKeyText = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAn9...\n-----END RSA PRIVATE KEY-----";
  const maskedPrivateKey = maskSensitiveData(privateKeyText);
  console.log("Original:", privateKeyText);
  console.log("Masked:  ", maskedPrivateKey);
  assert.ok(maskedPrivateKey.includes("[REDACTED_PRIVATE_KEY]"));

  const assignmentText = "const api_key = \"supersecret123\"; const secret = 'another_secret_456';";
  const maskedAssignment = maskSensitiveData(assignmentText);
  console.log("Original:", assignmentText);
  console.log("Masked:  ", maskedAssignment);
  assert.ok(maskedAssignment.includes("api_key = \"[REDACTED_CREDENTIAL]\""));
  assert.ok(maskedAssignment.includes("secret = '[REDACTED_CREDENTIAL]'"));

  console.log("\n=== Running Cryptographic Vault Tests ===");
  const masterKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"; // 32 bytes hex
  const userId1 = "user-123";
  const userId2 = "user-456";

  const key1 = await deriveUserKey(masterKey, userId1);
  const key2 = await deriveUserKey(masterKey, userId2);
  console.log("Derived Key 1 (user-123):", key1);
  console.log("Derived Key 2 (user-456):", key2);
  assert.notStrictEqual(key1, key2);

  const secretValue = "super-sensitive-slack-api-token-value";
  const encrypted1 = await encrypt(secretValue, key1);
  console.log("Encrypted with user-123 key:", encrypted1);

  const decrypted1 = await decrypt(encrypted1, key1);
  console.log("Decrypted with user-123 key:", decrypted1);
  assert.strictEqual(decrypted1, secretValue);

  // Decryption with wrong key must fail
  await assert.rejects(async () => {
    await decrypt(encrypted1, key2);
  }, /decryption failed|bad decrypt|Cipher job failed|OperationError/i);

  console.log("\nAll Tests Passed Successfully!");
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
