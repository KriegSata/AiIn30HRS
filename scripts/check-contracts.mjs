import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import SwaggerParser from '@apidevtools/swagger-parser';
const spec = JSON.parse(readFileSync('contracts/openapi.yaml', 'utf8'));
await SwaggerParser.validate(structuredClone(spec));
const ids = new Set();
let operations = 0;
for (const [path, methods] of Object.entries(spec.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    if (!['get','post','put','patch','delete'].includes(method)) continue;
    assert(operation.operationId, `${method} ${path} lacks operationId`);
    assert(!ids.has(operation.operationId), `Duplicate operationId ${operation.operationId}`);
    ids.add(operation.operationId);
    assert(Object.keys(operation.responses).some(s => /^2/.test(s)), `No success response ${path}`);
    operations++;
  }
}
console.log(`OpenAPI valid: ${operations} operations, ${Object.keys(spec.components.schemas).length} schemas.`);
