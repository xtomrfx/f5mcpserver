#!/usr/bin/env node

const express = require('express');
const https = require('https');

const app = express();
app.use(express.json());

// 开关：是否打印与 F5 设备交互的详细日志。可通过环境变量 LOG_F5="true" 来启用。
const LOG_F5 = process.env.LOG_F5 === 'true';

// 全局日志：打印请求 & 响应（MCP client ↔ MCP server）
app.use((req, res, next) => {
  console.log(`\n----- MCP REQUEST -----`);
  console.log(`${req.method} ${req.originalUrl}`);
  console.log(`Request Body:`, JSON.stringify(req.body, null, 2));
  const _json = res.json;
  res.json = function(data) {
    console.log(`Response Body:`, JSON.stringify(data, null, 2));
    console.log(`----- END REQUEST -----\n`);
    return _json.call(this, data);
  };
  next();
});

// HTTPS agent to skip certificate validation
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * 通用 F5 REST 调用（LTM 相关），兼容删除无返回体。
 * @param {string} method HTTP 方法，例如 'GET'、'POST'、'PUT'、'DELETE'
 * @param {string} path   F5 LTM API 路径，例如 '/pool'
 * @param {object|null} body 请求体对象。如果为 null，则不带 body。
 * @param {object} opts  包含 f5_url、f5_username、f5_password
 */
async function f5Request(method, path, body, opts) {
  const { f5_url, f5_username, f5_password } = opts;
  const url = `${f5_url}/mgmt/tm/ltm${path}`;
  const auth = 'Basic ' + Buffer.from(`${f5_username}:${f5_password}`).toString('base64');
  const headers = { 'Content-Type': 'application/json', Authorization: auth };

  if (LOG_F5) {
    console.log(`\n[F5 REQUEST] Method=${method}, URL=${url}`);
    console.log(`Headers:`, JSON.stringify(headers));
    console.log(`Body:`, body ? JSON.stringify(body) : 'null');
  }

  const resp = await fetch(url, { method, headers, agent: httpsAgent, body: body ? JSON.stringify(body) : null });
  const status = resp.status;
  const respText = await resp.text();

  if (LOG_F5) {
    console.log(`[F5 RESPONSE] Status=${status}, Body:`, respText || '""');
  }

  if (!resp.ok) {
    throw new Error(`F5 API ${method} ${path} failed: ${respText}`);
  }
  if (!respText) return null;
  try {
    return JSON.parse(respText);
  } catch {
    return null;
  }
}

/**
 * 通用 F5 系统 API 调用（例如 /mgmt/tm/sys/*），兼容删除无返回体。
 */
async function f5RequestSys(method, path, body, opts) {
  const { f5_url, f5_username, f5_password } = opts;
  const url = `${f5_url}/mgmt/tm/sys${path}`;
  const auth = 'Basic ' + Buffer.from(`${f5_username}:${f5_password}`).toString('base64');
  const headers = { 'Content-Type': 'application/json', Authorization: auth };

  if (LOG_F5) {
    console.log(`\n[F5 SYS REQUEST] Method=${method}, URL=${url}`);
    console.log(`Headers:`, JSON.stringify(headers));
    console.log(`Body:`, body ? JSON.stringify(body) : 'null');
  }

  const resp = await fetch(url, { method, headers, agent: httpsAgent, body: body ? JSON.stringify(body) : null });
  const status = resp.status;
  const respText = await resp.text();

  if (LOG_F5) {
    console.log(`[F5 SYS RESPONSE] Status=${status}, Body:`, respText || '""');
  }

  if (!resp.ok) {
    throw new Error(`F5 API ${method} ${path} failed: ${respText}`);
  }
  if (!respText) return null;
  try {
    return JSON.parse(respText);
  } catch {
    return null;
  }
}

// ===== 工具实现 =====
async function runConfigurePool(opts) {
  const { pool_name, members } = opts;
  if (!pool_name || !Array.isArray(members)) throw new Error('Missing pool_name or members');
  await f5Request('POST', '/pool', { name: pool_name, partition: 'Common' }, opts);
  for (const m of members) {
    await f5Request(
      'POST',
      `/pool/~Common~${encodeURIComponent(pool_name)}/members`,
      { partition: 'Common', name: `${m.address}:${m.port}`, address: m.address },
      opts
    );
  }
  return { content: [{ type: 'text', text: `OK Pool '${pool_name}' created with ${members.length} members.` }] };
}

async function runRemoveMember(opts) {
  const { pool_name, member_address, member_port } = opts;
  if (!pool_name || !member_address || !member_port) throw new Error('Missing pool_name, member_address or member_port');
  const id = encodeURIComponent(`${member_address}:${member_port}`);
  await f5Request('DELETE', `/pool/~Common~${encodeURIComponent(pool_name)}/members/${id}`, null, opts);
  return { content: [{ type: 'text', text: `OK Removed member ${member_address}:${member_port} from pool '${pool_name}'.` }] };
}

async function runDeletePool(opts) {
  const { pool_name } = opts;
  if (!pool_name) throw new Error('Missing pool_name');
  // 删除时使用不带 partition 的路径
  await f5Request('DELETE', `/pool/${encodeURIComponent(pool_name)}`, null, opts);
  return { content: [{ type: 'text', text: `OK Pool '${pool_name}' deleted.` }] };
}

async function runCreateVirtualServer(opts) {
  const { virtual_name, ip, port, pool_name } = opts;
  if (!virtual_name || !ip || !port) throw new Error('Missing virtual_name, ip or port');
  const cfg = { name: virtual_name, destination: `${ip}:${port}`, mask: '255.255.255.255', ipProtocol: 'tcp', profiles: [{ name: 'tcp' }] };
  if (pool_name) cfg.pool = pool_name;
  await f5Request('POST', '/virtual', cfg, opts);
  return { content: [{ type: 'text', text: `OK Virtual Server '${virtual_name}' created.` }] };
}

async function runDeleteVirtualServer(opts) {
  const { virtual_name } = opts;
  if (!virtual_name) throw new Error('Missing virtual_name');
  await f5Request('DELETE', `/virtual/~Common~${encodeURIComponent(virtual_name)}`, null, opts);
  return { content: [{ type: 'text', text: `OK Virtual Server '${virtual_name}' deleted.` }] };
}

async function runGetPoolMemberStatus(opts) {
  const { pool_name } = opts;
  if (!pool_name) throw new Error('Missing pool_name');
  const stats = await f5Request('GET', `/pool/~Common~${encodeURIComponent(pool_name)}/members/stats`, null, opts);
  const entries = stats?.entries || {};
  const rows = Object.values(entries).map(e => {
    const n = e.nestedStats.entries;
    const address = n['addr']?.description || n['address']?.description || 'unknown';
    const port = n['port']?.value || n['port']?.description || 'unknown';
    const avail = n['status.availabilityState']?.description || 'unknown';
    return { address, port, status: avail.toLowerCase()==='available' ? 'up' : 'down' };
  });
  return { content: [{ type: 'text', text: `OK Pool '${pool_name}' members: ${JSON.stringify(rows)}` }] };
}

async function runGetLtmLogs(opts) {
  const { start_time, end_time } = opts;
  if (!start_time || !end_time) {
    throw new Error('Missing start_time or end_time');
  }
  const range = `${start_time}--${end_time}`;
  const path = `/log/ltm/stats?options=range,${encodeURIComponent(range)}`;
  const logs = await f5RequestSys('GET', path, null, opts);
  return {
    content: [{
      type: 'text',
      text: `📄 LTM Logs from ${start_time} to ${end_time}:
${JSON.stringify(logs, null, 2)}`
    }]
  };
}

async function runAddIrules(opts) {
  const { irule_name, irule_code, partition } = opts;
  if (!irule_name || !irule_code) throw new Error('Missing irule_name or irule_code');
  const body = { name: irule_name, partition: partition || 'Common', apiAnonymous: irule_code };
  await f5Request('POST', '/rule', body, opts);
  return { content: [{ type: 'text', text: `OK iRule '${irule_name}' created.` }] };
}

async function runUpdateMemberStat(opts) {
  const { pool_name, member_address, member_port, action } = opts;
  if (!pool_name || !member_address || !member_port || !action) {
    throw new Error('Missing pool_name, member_address, member_port or action');
  }
  const poolFq = `~Common~${encodeURIComponent(pool_name)}`;
  const memberId = encodeURIComponent(`~Common~${member_address}:${member_port}`);
  const body = {
    state: 'user-up',
    session: action === 'enable' ? 'user-enabled' : 'user-disabled'
  };
  await f5Request('PUT', `/pool/${poolFq}/members/${memberId}`, body, opts);
  const verb = action === 'enable' ? 'enabled' : 'disabled';
  return { content: [{ type: 'text', text: `OK, member ${member_address}:${member_port} ${verb}.` }] };
}

async function runGetCpuStat(opts) {
  const { f5_url, f5_username, f5_password } = opts;
  if (!f5_url || !f5_username || !f5_password) {
    throw new Error('Missing f5_url, f5_username or f5_password');
  }
  const data = await f5RequestSys('GET', '/cpu', null, opts);
  return {
    content: [
      { type: 'text', text: `🖥️ CPU Stats:
${JSON.stringify(data, null, 2)}` }
    ]
  };
}

// ===== 工具声明 =====
const tools = [
  {
    name: 'configurePool',
    description: 'Create a new pool and add members',
    inputSchema: { /* ... 原有 schema ... */ },
    handler: runConfigurePool
  },
  /* 其余工具定义保持不变 */
];

// ===== MCP 接口 =====
app.post('/mcp/list-tools', (req, res) => res.json({ tools }));
app.post('/mcp/invoke', async (req, res) => {
  const { name, arguments: args, params } = req.body;
  const toolName = name || params?.name;
  const toolArgs = args || params?.arguments || {};
  const tool = tools.find(t => t.name === toolName);
  if (!tool) return res.status(400).json({ error: `Unknown tool: ${toolName}` });
  try {
    const result = await tool.handler(toolArgs);
    return res.json(result);
  } catch (e) {
    console.error(`[Tool Error] ${e.stack}`);
    return res.status(500).json({ content: [{ type: 'text', text: `error ${e.message}` }] });
  }
});

// ===== 根路径 JSON-RPC =====
app.post('/', async (req, res) => {
  const { jsonrpc, id, method, params } = req.body;
  if (method === 'initialize') {
    return res.json({ jsonrpc: '2.0', id, result: { protocolVersion: '2025-03-26', capabilities: { listTools: true, invoke: true, call: true }, serverInfo: { name: 'f5ConfigServer', version: '1.0.0' } } });
  }
  if (method === 'mcp:list-tools' || method === 'tools/list') {
    return res.json({ jsonrpc: '2.0', id, result: { tools } });
  }
  if (['tools/invoke', 'mcp:invoke', 'tools/call', 'mcp:call-tool'].includes(method)) {
    const { name, arguments: args } = params || {};
    const tool = tools.find(t => t.name === name);
    if (!tool) return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${name}` } });
    try {
      const result = await tool.handler(args || {});
      return res.json({ jsonrpc: '2.0', id, result });
    } catch (e) {
      console.error(`[RPC Tool Error] ${e.stack}`);
      return res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: e.message } });
    }
  }
  if (method === 'ping') {
    return res.json({ jsonrpc: '2.0', id, result: {} });
  }
  return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
});

// ===== 启动 =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`OK MCP Server running on port ${PORT}`));
