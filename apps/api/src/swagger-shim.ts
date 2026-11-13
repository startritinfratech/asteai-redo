// src/swagger-shim.ts
// When running under bun, @nestjs/swagger decorators crash due to
// descriptor.value being undefined (bun decorator stage difference).
// This shim replaces them all with no-ops at dev time.
// Production builds use the real swagger via compiled JS (tsc output).

const noop = () => () => {};

export const ApiTags = noop;
export const ApiBearerAuth = noop;
export const ApiOperation = noop;
export const ApiProperty = noop;
export const ApiResponse = noop;
export const ApiBody = noop;
export const ApiParam = noop;
export const ApiQuery = noop;
export const SwaggerModule = { createDocument: () => ({}), setup: () => {} };
export class DocumentBuilder {
  setTitle()       { return this; }
  setDescription() { return this; }
  setVersion()     { return this; }
  addBearerAuth()  { return this; }
  build()          { return {}; }
}
