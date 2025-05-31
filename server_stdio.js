#!/usr/bin/env node

/**
 *  这是一个基于 stdio（标准输入/输出）的 MCP Server 实现。
 *  它读取 stdin 每一行 JSON 请求，按 JSON‐RPC 规范分发到相应的工具处理函数，
 *  然后把响应 JSON 串写到 stdout，并自动换行。
 */

const https = require('https');
const readline = require('readline');

// === 1. 通用 HTTP(s) Agent （跳过证书验证） ===
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * 统一的 F5 REST 调用封装（POST/GET/PUT/DELETE）。
 * - method: HTTP 方法字符串，比如 'GET'、'POST'
 * - path: 以 / 开头的 F5 REST 路径，比如 '/pool'、'/virtual'
 * - body: JS 对象（会自动序列化成 JSON）
 * - opts: 必须包含 { f5_url, f5_username, f5_password }
 */

// 通用 F5 REST 调用，兼容删除无返回体
async function f5Request(method, path, body, opts) {
  const { f5_url, f5_username, f5_password } = opts;
  const url = `${f5_url}/mgmt/tm/ltm${path}`;
  const auth = 'Basic ' + Buffer.from(`${f5_username}:${f5_password}`).toString('base64');
  const headers = { 'Content-Type': 'application/json', Authorization: auth };
  const resp = await fetch(url, { method, headers, agent: httpsAgent, body: body ? JSON.stringify(body) : null });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`F5 API ${method} ${path} failed: ${txt}`);
  }
  // 尝试解析 JSON，若无内容则返回 null,一些API call会无返回，出现执行成功但是报错，造成模型困扰
  const text = await resp.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function f5RequestSys(method, path, body, opts) {
  const { f5_url, f5_username, f5_password } = opts;
  const url = `${f5_url}/mgmt/tm/sys${path}`;
  const auth = 'Basic ' + Buffer.from(`${f5_username}:${f5_password}`).toString('base64');
  const headers = { 'Content-Type': 'application/json', Authorization: auth };
  const resp = await fetch(url, { method, headers, agent: httpsAgent, body: body ? JSON.stringify(body) : null });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`F5 API ${method} ${path} failed: ${txt}`);
  }
  const text = await resp.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// ===== 工具实现 =====
async function runConfigurePool(opts) {
  const { pool_name, members } = opts;
  if (!pool_name || !Array.isArray(members)) throw new Error('Missing pool_name or members');
  await f5Request('POST', '/pool', { name: pool_name, partition: 'Common' }, opts);
  for (const m of members) {
    await f5Request('POST', `/pool/~Common~${encodeURIComponent(pool_name)}/members`, { partition: 'Common', name: `${m.address}:${m.port}`, address: m.address }, opts);
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
      text: `📄 LTM Logs from ${start_time} to ${end_time}:\n${JSON.stringify(logs, null, 2)}`
    }]
  };
}


async function runAddIrules(opts) {
  const { irule_name, irule_code, partition } = opts;
  if (!irule_name || !irule_code) throw new Error('Missing irule_name or irule_code');
  const body = {
    name: irule_name,
    partition: partition || 'Common',
    apiAnonymous: irule_code
  };
  await f5Request('POST', '/rule', body, opts);
  return { content: [{ type: 'text', text: `OK iRule '${irule_name}' created.` }] };
}



// ===== 新版：更新 pool member 状态（普通 API 管理，无 iApp） =====
async function runUpdateMemberStat(opts) {
  const { pool_name, member_address, member_port, action } = opts;
  if (!pool_name || !member_address || !member_port || !action) {
    throw new Error('Missing pool_name, member_address, member_port or action');
  }
  // 1) pool 的 URL 片段
  const poolFq = `~Common~${encodeURIComponent(pool_name)}`;
  // 2) member ID 只要 分区+address:port，不要 pool 名
  //    e.g. "~Common~10.1.10.6:53"
  const memberId = encodeURIComponent(`~Common~${member_address}:${member_port}`);
  // 3) 切换 session 字段即可启用/禁用新连接
  const body = {
    state: 'user-up',
    session: action === 'enable'
      ? 'user-enabled'
      : 'user-disabled'
  };
  // 4) 普通 API 管理用 PUT，注意路径中没有重复 pool_name
  await f5Request(
    'PUT',
    `/pool/${poolFq}/members/${memberId}`,
    body,
    opts
  );
  const verb = action === 'enable' ? 'enabled' : 'disabled';
  return {
    content: [{
      type: 'text',
      text: `OK, member ${member_address}:${member_port} ${verb}.`
    }]
  };
}

async function runGetCpuStat(opts) {
  const { f5_url, f5_username, f5_password } = opts;
  if (!f5_url || !f5_username || !f5_password) {
    throw new Error('Missing f5_url, f5_username or f5_password');
  }
  const data = await f5RequestSys('GET', '/cpu', null, opts);
  return {
    content: [
      {
        type: 'text',
        text: `🖥️ CPU Stats:\n${JSON.stringify(data, null, 2)}`
      }
    ]
  };
}



// ===== 工具声明 =====
const tools = [
  {
    name: 'configurePool',
    description: 'Create a new pool and add members',
    inputSchema: {
      type: 'object',
      properties: {
        f5_url:      { type: 'string', description: 'F5 management URL, e.g. https://host' },
        f5_username: { type: 'string', description: 'F5 username' },
        f5_password: { type: 'string', description: 'F5 password' },
        pool_name:   { type: 'string', description: 'Name of the pool to create' },
        members: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              address: { type: 'string', description: 'Member IP address' },
              port:    { type: 'integer', description: 'Member port' }
            },
            required: ['address', 'port']
          },
          description: 'Array of pool members'
        }
      },
      required: ['f5_url','f5_username','f5_password','pool_name','members'],
      additionalProperties: false
    },
    handler: runConfigurePool
  },
  {
    name: 'removeMember',
    description: 'Remove a member from a pool',
    inputSchema: {
      type: 'object',
      properties: {
        f5_url:         { type: 'string' },
        f5_username:    { type: 'string' },
        f5_password:    { type: 'string' },
        pool_name:      { type: 'string' },
        member_address: { type: 'string', description: 'Member IP' },
        member_port:    { type: 'integer', description: 'Member port' }
      },
      required: ['f5_url','f5_username','f5_password','pool_name','member_address','member_port'],
      additionalProperties: false
    },
    handler: runRemoveMember
  },
  {
    name: 'deletePool',
    description: 'Delete an entire pool',
    inputSchema: {
      type: 'object',
      properties: {
        f5_url:      { type: 'string' },
        f5_username: { type: 'string' },
        f5_password: { type: 'string' },
        pool_name:   { type: 'string' }
      },
      required: ['f5_url','f5_username','f5_password','pool_name'],
      additionalProperties: false
    },
    handler: runDeletePool
  },
  {
    name: 'createVirtualServer',
    description: 'Create a virtual server and bind it to a pool',
    inputSchema: {
      type: 'object',
      properties: {
        f5_url:       { type: 'string' },
        f5_username:  { type: 'string' },
        f5_password:  { type: 'string' },
        virtual_name: { type: 'string', description: 'Name of the virtual server' },
        ip:           { type: 'string', description: 'Virtual IP' },
        port:         { type: 'integer', description: 'Virtual port' },
        pool_name:    { type: 'string', description: 'Pool to attach (optional)' }
      },
      required: ['f5_url','f5_username','f5_password','virtual_name','ip','port'],
      additionalProperties: false
    },
    handler: runCreateVirtualServer
  },
  {
    name: 'deleteVirtualServer',
    description: 'Delete a virtual server',
    inputSchema: {
      type: 'object',
      properties: {
        f5_url:       { type: 'string' },
        f5_username:  { type: 'string' },
        f5_password:  { type: 'string' },
        virtual_name: { type: 'string' }
      },
      required: ['f5_url','f5_username','f5_password','virtual_name'],
      additionalProperties: false
    },
    handler: runDeleteVirtualServer
  },
  {
    name: 'getPoolMemberStatus',
    description: 'Get status of members in a pool',
    inputSchema: {
      type: 'object',
      properties: {
        f5_url:      { type: 'string' },
        f5_username: { type: 'string' },
        f5_password: { type: 'string' },
        pool_name:   { type: 'string', description: 'Name of the pool' }
      },
      required: ['f5_url','f5_username','f5_password','pool_name'],
      additionalProperties: false
    },
    handler: runGetPoolMemberStatus
  },
  {
    name: 'getLtmLogs',
    description: 'Retrieve LTM logs within a specified time range',
    inputSchema: {
      type: 'object',
      properties: {
        f5_url:       { type: 'string', description: 'F5 management URL, e.g. https://host' },
        f5_username:  { type: 'string', description: 'F5 username' },
        f5_password:  { type: 'string', description: 'F5 password' },
        start_time:   { type: 'string', description: 'ISO timestamp for range start, e.g. 2025-05-30T00:00:00Z' },
        end_time:     { type: 'string', description: 'ISO timestamp for range end, e.g. 2025-05-30T15:00:00Z' }
      },
      required: ['f5_url','f5_username','f5_password','start_time','end_time'],
      additionalProperties: false
  },
  handler: runGetLtmLogs
  },
  {
    name: 'updateMemberStat',
    description: 'Enable or disable a member in a pool',
    inputSchema: {
      type: 'object',
      properties: {
         f5_url:          { type: 'string', description: 'F5 management URL, e.g. https://host' },
         f5_username:     { type: 'string', description: 'F5 username' },
         f5_password:     { type: 'string', description: 'F5 password' },
         pool_name:       { type: 'string', description: 'Name of the pool' },
         member_address:  { type: 'string', description: 'Member IP address' },
         member_port:     { type: 'integer', description: 'Member port' },
         action: {
           type: 'string',
          enum: ['enable', 'disable'],
           description: "Action to perform: 'enable' or 'disable'"
       }
     },
     required: ['f5_url','f5_username','f5_password','pool_name','member_address','member_port','action'],
     additionalProperties: false
   },
   handler: runUpdateMemberStat
   },
   {
  name: 'addIrules',
  description: 'Upload an iRule to the F5',
  inputSchema: {
    type: 'object',
    properties: {
      f5_url:      { type: 'string' },
      f5_username: { type: 'string' },
      f5_password: { type: 'string' },
      irule_name:  { type: 'string', description: 'Name of the iRule' },
      irule_code:  { type: 'string', description: 'The iRule script content' },
      partition:   { type: 'string', description: 'Partition to upload the iRule to (default Common)' }
    },
    required: ['f5_url','f5_username','f5_password','irule_name','irule_code'],
    additionalProperties: false
  },
  handler: runAddIrules
},{
    name: 'getCpuStat',
    description: 'Get CPU statistics from the F5 device (via /mgmt/tm/sys/cpu)',
    inputSchema: {
      type: 'object',
      properties: {
        f5_url:      { type: 'string', description: 'F5 管理地址，例如 https://<host>' },
        f5_username: { type: 'string', description: 'F5 用户名' },
        f5_password: { type: 'string', description: 'F5 密码' }
      },
      required: ['f5_url','f5_username','f5_password'],
      additionalProperties: false
    },
    handler: runGetCpuStat
  }
];
// === 4. stdio JSON-RPC 逻辑 ===
// 读取 stdin，按行解析 JSON；处理之后输出到 stdout
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

// 工具列表示例，供 `tools/list` 调用
const toolsList = tools.map(t => t.name);

// 给 stderr 打印日志更方便调试
function logError(...args) {
  console.error('[MCP ERROR]', ...args);
}

// 处理单条 JSON-RPC 消息
async function handleMessage(msg) {
  const { jsonrpc, id, method, params } = msg;

  // 1) 首先必须带 jsonrpc:"2.0" 和 id
  if (jsonrpc !== '2.0' || id === undefined) {
    return {
      jsonrpc: '2.0',
      id: id || null,
      error: { code: -32600, message: 'Invalid Request' }
    };
  }

  // 2) 初始化（MCP 客户端通常会首先发 initialize）
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { listTools: true, invoke: true, call: true },
        serverInfo: { name: 'f5-ltm-mcp', version: '1.0.0' }
      }
    };
  }

  // 3) 列出工具：tools/list 或 mcp:list-tools
  if (method === 'tools/list' || method === 'mcp:list-tools') {
    return {
      jsonrpc: '2.0',
      id,
      result: { tools: toolsList }
    };
  }


  // 4) 调用工具：tools/invoke, mcp:invoke, tools/call, mcp:call-tool
  if (['tools/invoke', 'mcp:invoke', 'tools/call', 'mcp:call-tool'].includes(method)) {
    // JSON-RPC 规范里，调用形如：
    //  { jsonrpc:"2.0", method:"tools/invoke", params:{ name:"configurePool", arguments:{ ... }, f5_url:..., f5_username:..., f5_password:... }, id:1 }
    // 有些实现把 name/key:toolName 放在 params.name，也要兼容
    const toolName = params?.name || params?.arguments?.name;
    const toolArgs = params?.arguments || {};
    if (!toolName) {
      return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Missing tool name' } };
    }
    const tool = tools.find(t => t.name === toolName);
    if (!tool) {
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${toolName}` } };
    }
    try {
      // 将所有 params.arguments 字段展开，再加上必要的 f5_url/f5_username/f5_password
      const result = await tool.handler(toolArgs);
      return { jsonrpc: '2.0', id, result };
    } catch (e) {
      return { jsonrpc: '2.0', id, error: { code: -32000, message: e.message } };
    }
  }

  // 5) 心跳 / ping
  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }

  // 6) 方法未找到
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}

// 监听 stdin 每一行
rl.on('line', async (line) => {
  if (!line || !line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (e) {
    // 解析失败，直接回复 JSON-RPC 格式的 Parse Error
    const resp = {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error: invalid JSON' }
    };
    process.stdout.write(JSON.stringify(resp) + '\n');
    return;
  }

  // 处理合法 JSON-RPC 请求
  let responseObj;
  try {
    responseObj = await handleMessage(msg);
  } catch (err) {
    responseObj = {
      jsonrpc: '2.0',
      id: msg.id || null,
      error: { code: -32603, message: `Internal error: ${err.message}` }
    };
  }
  // 输出响应，末尾加换行
  process.stdout.write(JSON.stringify(responseObj) + '\n');
});

// 捕获 stdin 关闭（MCP 客户端停止时会关闭 stdin）
rl.on('close', () => {
  console.log('MCP Server stdin closed, exiting.');
  process.exit(0);
});

// 启动时打日志
console.log('OK MCP Server (stdio mode) is running. Awaiting JSON-RPC on stdin...');