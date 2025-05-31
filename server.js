#!/usr/bin/env node


const express = require('express');
const https = require('https');

const app = express();
app.use(express.json());

// 全局日志：打印请求 & 响应
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

// ===== MCP 接口 =====
app.post('/mcp/list-tools', (req, res) => res.json({ tools }));
app.post('/mcp/invoke', async (req, res) => {
  const { name, arguments: args, params } = req.body;
  const toolName = name || params?.name;
  const toolArgs = args || params?.arguments || {};
  const tool = tools.find(t => t.name === toolName);
  if (!tool) return res.status(400).json({ error:`Unknown tool: ${toolName}` });
  try { const result = await tool.handler(toolArgs); return res.json(result); }
  catch(e) { return res.status(500).json({ content:[{type:'text',text:`error ${e.message}`}] }); }
});

// ===== 根路径 JSON-RPC =====
app.post('/', async (req, res) => {
  const { jsonrpc,id,method,params } = req.body;
  if (method==='initialize') {
    return res.json({ jsonrpc:'2.0', id, result:{ protocolVersion:'2025-03-26', capabilities:{listTools:true,invoke:true,call:true}, serverInfo:{name:'f5ConfigServer',version:'1.0.0'} } });
  }
  if (method==='mcp:list-tools'||method==='tools/list') {
    return res.json({ jsonrpc:'2.0',id,result:{tools} });
  }
  if (['tools/invoke','mcp:invoke','tools/call','mcp:call-tool'].includes(method)) {
    const { name, arguments:args } = params||{};
    const tool=tools.find(t=>t.name===name);
    if (!tool) return res.json({ jsonrpc:'2.0',id,error:{code:-32601,message:`Unknown tool: ${name}`} });
    try{ const result=await tool.handler(args||{}); return res.json({jsonrpc:'2.0',id,result}); }
    catch(e){ return res.json({jsonrpc:'2.0',id,error:{code:-32000,message:e.message}}); }
  }
  if (method === 'ping') {
    return res.json({ jsonrpc: "2.0", id, result: {}});
  }
  return res.json({jsonrpc:'2.0',id,error:{code:-32601,message:`Method not found: ${method}`} });
});

// ===== 启动 =====
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(`OK MCP Server running on port ${PORT}`));
