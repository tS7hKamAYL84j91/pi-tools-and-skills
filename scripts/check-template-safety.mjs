#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const paths = [
  'tests/fixtures/template-safety/public-pack/review-template.md',
];

const rules = [
  ['secret-placeholder', /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|private[_-]?key|secret)\b/gi],
  ['private-path', /(?:\.workers|\.env|~\/\.ssh|keychain|credential store)/gi],
  ['raw-session-request', /\braw\s+(?:session|transcript|conversation|prompt|tool payload)s?\b/gi],
];

const findings = [];
for (const path of paths) {
  if (!path.startsWith('tests/fixtures/template-safety/')) {
    throw new Error(`Refusing non-fixture path: ${path}`);
  }
  const content = await readFile(path, 'utf8');
  for (const [ruleId, pattern] of rules) {
    for (const match of content.matchAll(pattern)) {
      const line = content.slice(0, match.index ?? 0).split('\n').length;
      findings.push(`${path}:${line} ${ruleId}`);
    }
  }
}

if (findings.length > 0) {
  console.error(`Template safety FAIL: ${findings.length} finding(s).`);
  for (const finding of findings) console.error(finding);
  process.exit(1);
}
console.log(`Template safety PASS: checked ${paths.length} fixture(s).`);
