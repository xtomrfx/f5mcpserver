#!/usr/bin/env node

// local 运行请安装最新的node js
// 1. npm init -y  
// 2. npm install express
// 3. node + 文件名

const express = require('express');
const https = require('https');
const fetch = require('node-fetch');


const app = express();
app.use(express.json());

// ===== 日志开关配置 =====
// 将这两个值设置为 true 或 false 来开启/关闭对应的日志
const ENABLE_CLIENT_LOG = true; // 控制 MCP Server <-> Client 的通信日志
const ENABLE_F5_LOG = true;     // 控制 MCP Server <-> F5 设备 的通信日志

// 全局日志：打印请求 & 响应（Client <-> MCP Server）
// 仅在 ENABLE_CLIENT_LOG 为 true 时才输出
app.use((req, res, next) => {
  if (ENABLE_CLIENT_LOG) {
    console.log(`\n----- MCP REQUEST -----`);
    console.log(`${req.method} ${req.originalUrl}`);
    console.log(`Request Body:`, JSON.stringify(req.body, null, 2));
    const _json = res.json;
    res.json = function(data) {
      console.log(`Response Body:`, JSON.stringify(data, null, 2));
      console.log(`----- END REQUEST -----\n`);
      return _json.call(this, data);
    };
  }
  next();
});

// HTTPS agent to skip certificate validation
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// 通用 F5 REST 调用，兼容删除无返回体
// 这里使用全局 fetch（Node.js 18+）来替代 node-fetch
async function f5Request(method, path, body, opts) {
  const { f5_url, f5_username, f5_password } = opts;
  const url = `${f5_url}/mgmt/tm/ltm${path}`;
  const auth = 'Basic ' + Buffer.from(`${f5_username}:${f5_password}`).toString('base64');
  const headers = { 'Content-Type': 'application/json', Authorization: auth };

  if (ENABLE_F5_LOG) {
    console.log(`\n----- F5 REQUEST -----`);
    console.log(`Method: ${method}`);
    console.log(`URL   : ${url}`);
    if (body) {
      console.log(`Request Body: ${JSON.stringify(body, null, 2)}`);
    } else {
      console.log(`Request Body: <empty>`);
    }
  }

  // 在这里捕获 fetch 可能抛出的底层异常
  let resp;
  let respText;
  try {
    resp = await fetch(url, {
      method,
      headers,
      agent: httpsAgent,
      body: body ? JSON.stringify(body) : null
    });
    respText = await resp.text();
  } catch (err) {
    // 打印出完整的错误对象，方便排查是网络、TLS、还是其它问题
    console.error("底层 fetch 调用出错：", err);
    // 抛出的错误消息中包含 err.message，Client 会收到类似 “fetch failed: connect ECONNREFUSED” 的信息
    throw new Error(`fetch failed: ${err.message}`);
  }

  if (ENABLE_F5_LOG) {
    console.log(`Response Status: ${resp.status} ${resp.statusText}`);
    console.log(`Response Body  : ${respText || '<empty>'}`);
    console.log(`----- END F5 REQUEST -----\n`);
  }

  if (!resp.ok) {
    // F5 本身返回了非 2xx 的状态码，我们把它当作错误抛出，同时把返回的 Body 也显示出来
    throw new Error(`F5 API ${method} ${path} failed: ${respText}`);
  }
  if (!respText) return null;

  try {
    return JSON.parse(respText);
  } catch {
    // 如果返回的不是合法 JSON，就直接返回 null 而不抛异常
    return null;
  }
}

// ===== 带详细错误日志的 f5RequestSys =====
async function f5RequestSys(method, path, body, opts) {
  const { f5_url, f5_username, f5_password } = opts;
  const url = `${f5_url}/mgmt/tm/sys${path}`;
  const auth = 'Basic ' + Buffer.from(`${f5_username}:${f5_password}`).toString('base64');
  const headers = { 'Content-Type': 'application/json', Authorization: auth };

  if (ENABLE_F5_LOG) {
    console.log(`\n----- F5 (SYS) REQUEST -----`);
    console.log(`Method: ${method}`);
    console.log(`URL   : ${url}`);
    if (body) {
      console.log(`Request Body: ${JSON.stringify(body, null, 2)}`);
    } else {
      console.log(`Request Body: <empty>`);
    }
  }

  // 在这里捕获 fetch 可能抛出的底层异常
  let resp;
  let respText;
  try {
    resp = await fetch(url, {
      method,
      headers,
      agent: httpsAgent,
      body: body ? JSON.stringify(body) : null
    });
    respText = await resp.text();
  } catch (err) {
    console.error("底层 fetch 调用出错（SYS 路径）：", err);
    throw new Error(`fetch failed: ${err.message}`);
  }

  if (ENABLE_F5_LOG) {
    console.log(`Response Status: ${resp.status} ${resp.statusText}`);
    console.log(`Response Body  : ${respText || '<empty>'}`);
    console.log(`----- END F5 (SYS) REQUEST -----\n`);
  }

  if (!resp.ok) {
    throw new Error(`F5 SYS API ${method} ${path} failed: ${respText}`);
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
  await f5Request('DELETE', `/pool/${encodeURIComponent(pool_name)}`, null, opts);
  return { content: [{ type: 'text', text: `OK Pool '${pool_name}' deleted.` }] };
}


 //列出所有 Pool 的信息
async function runListAllPoolStat(opts) {
  const { f5_url, f5_username, f5_password } = opts;
  if (!f5_url || !f5_username || !f5_password) {
    throw new Error('Missing f5_url, f5_username or f5_password');
  }
  const data = await f5Request('GET', '/pool', null, opts);
  return {
    content: [
      {
        type: 'text',
        text: `All Pools:\n${JSON.stringify(data, null, 2)}`
      }
    ]
  };
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
    return { address, port, status: avail.toLowerCase() === 'available' ? 'up' : 'down' };
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
      text: `LTM Logs from ${start_time} to ${end_time}:\n${JSON.stringify(logs, null, 2)}`
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
        text: `CPU Stats:\n${JSON.stringify(data, null, 2)}`
      }
    ]
  };
}

async function runListAllVirtual(opts) {
  const { f5_url, f5_username, f5_password } = opts;
  if (!f5_url || !f5_username || !f5_password) {
    throw new Error('Missing f5_url, f5_username or f5_password');
  }
  const data = await f5Request('GET', '/virtual', null, opts);
  return {
    content: [
      {
        type: 'text',
        text: `All Virtual Servers:\n${JSON.stringify(data, null, 2)}`
      }
    ]
  };
}

async function runGetTmmInfo(opts) {
  const data = await f5RequestSys('GET', '/tmm-info', null, opts);
  return {
    content: [
      {
        type: 'text',
        text: `TMM Info:\n${JSON.stringify(data, null, 2)}`
      }
    ]
  };
}

async function runGetConnection(opts) {
  const data = await f5RequestSys('GET', '/performance/connections/stats', null, opts);
  return {
    content: [
      {
        type: 'text',
        text: `Connection Info:\n${JSON.stringify(data, null, 2)}`
      }
    ]
  };
}

async function runGetCertificateStat(opts) {
  const data = await f5RequestSys('GET', '/crypto/cert', null, opts);
  return {
    content: [
      {
        type: 'text',
        text: `Certification Info:\n${JSON.stringify(data, null, 2)}`
      }
    ]
  };
}



/*  抓的是packets，不是实时流量，需要额外处理，后续增加
async function runGetThroughput(opts) {
  const data = await f5RequestSys('GET', '/performance/throughput/stats', null, opts);
  return {
    content: [
      {
        type: 'text',
        text: `Throughput Info:\n${JSON.stringify(data, null, 2)}`
      }
    ]
  };ß
}
*/



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
  },
  {
    name: 'getCpuStat',
    description: 'Get CPU statistics from the F5 device (via /mgmt/tm/sys/cpu)' +
    'Even CPU ID - numbered logical cores (0, 2, 4 …) are exclusively dedicated to TMM for handling data - plane tasks.' +
    'Odd  CPU ID- numbered logical cores (1, 3, 5 …) are used to run the control plane and other system processes.'+
    'the Ratio range in output is 1~100. example: fiveSecAvgUser: value 1 means fiveSecAvgUser is 1% usage' +
    'fiveSecAvgUser - The average time spent by the specified processor in user context for the associated host in the last five seconds.' +
    'fiveSecAvgSystem - The average time spent by the specified processor servicing system calls for the associated host in the last five seconds.',
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
  }, 
    {
    name: 'listAllPool',
    description: 'List all pools status incloud name, monitor, and other detail con the F5 device',
    inputSchema: {
      type: 'object',
      properties: {
        f5_url:      { type: 'string', description: 'F5 management URL, e.g. https://<host>' },
        f5_username: { type: 'string', description: 'F5 username' },
        f5_password: { type: 'string', description: 'F5 password' }
      },
      required: ['f5_url', 'f5_username', 'f5_password'],
      additionalProperties: false
    },
    handler: runListAllPoolStat
  },{
    name: 'listAllVirtual',
    description: 'List all virtual servers on the F5 device. some important key in the output:' +
    '- name: virtual server name\n' +
    '- ipProtocol: protocol type\n' +
    '- destination: VIP:port (e.g. 1.1.1.1:80)\n' +
    '- enabled: whether virtual server is enabled\n' +
    '- pool: pool name attached to the virtual server',
    inputSchema: {
      type: 'object',
      properties: {
        f5_url:      { type: 'string', description: 'F5 management URL, e.g. https://<host>' },
        f5_username: { type: 'string', description: 'F5 username' },
        f5_password: { type: 'string', description: 'F5 password' }
      },
      required: ['f5_url','f5_username','f5_password'],
      additionalProperties: false
    },
    handler: runListAllVirtual
  },{
    name: 'getTmmInfo',
    description: 'Get TMM resource usage information from the F5 device via /mgmt/tm/sys/tmm-info,' +
    'Even - numbered logical cores (0, 2, 4 …) are exclusively dedicated to TMM for handling data - plane tasks.' +
    'Odd - numbered logical cores (1, 3, 5 …) are used to run the control plane and other system processes.'+
    'the Ratio range in output is 1~100. example: fiveMinAvgUsageRatio: value 1 means fiveMinAvgUsageRatio is 1% usage' +
    'When the TMM core utilization exceeds ~80%, the system will "borrow" a small amount of remaining computing resources (about 20%) from the odd - numbered cores to ensure the continuous response of the data plane. ',
    inputSchema: {
      type: 'object',
      properties: {
        f5_url:      { type: 'string', description: 'F5 management URL, e.g. https://<host>' },
        f5_username: { type: 'string', description: 'F5 username' },
       f5_password: { type: 'string', description: 'F5 password' }
     },
     required: ['f5_url', 'f5_username', 'f5_password'],
     additionalProperties: false
    },
    handler: runGetTmmInfo
},{
    name: 'runGetConnection',
    description: 'Get connection performance from the F5 device via /mgmt/tm/sys/performance/connections/stats,' +
    'Client Connections - the connections statisitic from client to F5' +
    'Server Connections - the connections statisitic from F5 to backend Server' +
    'HTTP Requests - focus on HTTP request statisic ' +
    'Connections - connections statistic in F5 session table',
    inputSchema: {
      type: 'object',
      properties: {
        f5_url:      { type: 'string', description: 'F5 management URL, e.g. https://<host>' },
        f5_username: { type: 'string', description: 'F5 username' },
       f5_password: { type: 'string', description: 'F5 password' }
     },
     required: ['f5_url', 'f5_username', 'f5_password'],
     additionalProperties: false
    },
    handler: runGetConnection
},{
    name: 'runGetCertificateStat',
    description: 'Get ALL Certification information from the F5 device via /mgmt/tm/sys/performance/connections/stats,' ,
    inputSchema: {
      type: 'object',
      properties: {
        f5_url:      { type: 'string', description: 'F5 management URL, e.g. https://<host>' },
        f5_username: { type: 'string', description: 'F5 username' },
       f5_password: { type: 'string', description: 'F5 password' }
     },
     required: ['f5_url', 'f5_username', 'f5_password'],
     additionalProperties: false
    },
    handler: runGetCertificateStat
}

/*  throughput 是packets，不是bit/s ，需要额外计算，后续处理。

,{
    name: 'runGetThroughput',
    description: 'Get connection performance from the F5 device via /mgmt/tm/sys/performance/connections/stats,' +
    'In: The ingress traffic to the system, ' +
    'Out: The egress traffic from the system' +
    'Service: The larger of the two values of combined client and server-side ingress traffic or egress traffic, measured within TMM' +
    'SSL TPS: SSL TPS',
    inputSchema: {
      type: 'object',
      properties: {
        f5_url:      { type: 'string', description: 'F5 management URL, e.g. https://<host>' },
        f5_username: { type: 'string', description: 'F5 username' },
       f5_password: { type: 'string', description: 'F5 password' }
     },
     required: ['f5_url', 'f5_username', 'f5_password'],
     additionalProperties: false
    },
    handler: runGetThroughput
}
*/

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
    return res.status(500).json({ content: [{ type: 'text', text: `error ${e.message}` }] });
  }
});

// ===== 根路径 JSON-RPC =====
app.post('/', async (req, res) => {
  const { jsonrpc, id, method, params } = req.body;
  if (method === 'initialize') {
    return res.json({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { listTools: true, invoke: true, call: true },
        serverInfo: { name: 'f5ConfigServer', version: '1.0.0' }
      }
    });
  }
  if (method === 'mcp:list-tools' || method === 'tools/list') {
    return res.json({ jsonrpc: '2.0', id, result: { tools } });
  }
  if (['tools/invoke', 'mcp:invoke', 'tools/call', 'mcp:call-tool'].includes(method)) {
    const { name, arguments: args } = params || {};
    const tool = tools.find(t => t.name === name);
    if (!tool) {
      return res.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Unknown tool: ${name}` }
      });
    }
    try {
      const result = await tool.handler(args || {});
      return res.json({ jsonrpc: '2.0', id, result });
    } catch (e) {
      return res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: e.message } });
    }
  }
  if (method === 'ping') {
    return res.json({ jsonrpc: '2.0', id, result: {} });
  }
  return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
});

// ===== 启动 =====
// 获取 --port=xxxx 参数（默认 3000）
const args = process.argv.slice(2);
const portArg = args.find(arg => arg.startsWith('--port='));
const PORT = portArg ? parseInt(portArg.split('=')[1], 10) : (process.env.PORT || 3000);

// 启动监听
app.listen(PORT, () => {
  console.log(`OK,MCP Server running on port ${PORT}`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Sorry,Port ${PORT} is already in use. Please try a different port.\n
      nxp command : npx -y git+https://gitee.com/xtomrfx/f5-mcp.git --port=8088 \n
      local use: node server.js --port=xxx `);
  } else {
    throw err;
  }
});