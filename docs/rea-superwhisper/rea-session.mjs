// Local investigation runner. It uses the installed REA MCP server and writes
// complete tool results to this directory; stdout contains only a short status.
import { Client } from '/Users/outsider/.npm/_npx/af752b90495482d7/node_modules/@modelcontextprotocol/client/dist/index.mjs';
import { StdioClientTransport } from '/Users/outsider/.npm/_npx/af752b90495482d7/node_modules/@modelcontextprotocol/client/dist/stdio.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';

const output = dirname(fileURLToPath(import.meta.url));
await mkdir(output, { recursive: true });
const client = new Client({ name: 'superwhisper-investigation', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: '/Users/outsider/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node',
  args: [
    ...(process.env.REA_INVESTIGATION_LONG_STARTUP === '1'
      ? ['--import', join(output, 'hopper-startup-timeout.mjs')] : []),
    '/Users/outsider/.npm/_npx/af752b90495482d7/node_modules/rea-agents/scripts/rea.mjs', 'mcp',
  ],
  env: {
    ...process.env,
    HOPPER_LAUNCHER_PATH: '/Users/outsider/Applications/Hopper Disassembler.app/Contents/MacOS/hopper',
  },
  stderr: 'pipe',
});
transport.stderr?.on('data', data => process.stderr.write(data));
await client.connect(transport, { timeout: 30000 });
const catalog = await client.listTools();
await writeFile(join(output, 'tools-list.json'), JSON.stringify(catalog, null, 2));
console.log(JSON.stringify({ connected: true, tools: catalog.tools.length }));
const allowed = new Set(catalog.tools.map(tool => tool.name));
let sequence = 0;
const lines = createInterface({ input: process.stdin });
try {
  for await (const line of lines) {
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    if (request.quit) break;
    if (!allowed.has(request.tool)) throw new Error(`Unadvertised tool: ${request.tool}`);
    const stem = request.save || `${String(++sequence).padStart(2, '0')}-${request.tool}`;
    if (!/^[a-zA-Z0-9_-]+$/.test(stem)) throw new Error('Invalid result filename');
    console.log(JSON.stringify({ started: request.tool, save: stem }));
    try {
      const result = await client.callTool({ name: request.tool, arguments: request.arguments || {} }, { timeout: 360000 });
      await writeFile(join(output, `${stem}.json`), JSON.stringify({ request, result }, null, 2));
      const data = result.structuredContent;
      const texts = result.content?.filter(item => item.type === 'text').map(item => item.text).join('\n') || '';
      console.log(JSON.stringify({ finished: request.tool, isError: result.isError || false, file: `${stem}.json`, keys: data ? Object.keys(data) : [], summary: texts.slice(0, 650) }));
    } catch (error) {
      await writeFile(join(output, `${stem}-error.json`), JSON.stringify({ request, error: String(error) }, null, 2));
      console.log(JSON.stringify({ failed: request.tool, error: String(error) }));
    }
  }
} finally {
  await client.close();
}
