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

// ===== Util 模块请求函数 (用于执行 bash/tcpdump) =====
async function f5RequestUtil(method, path, body, opts) {
  const { f5_url, f5_username, f5_password } = opts;
  // 注意：这里路径是 /mgmt/tm/util
  const url = `${f5_url}/mgmt/tm/util${path}`;
  const auth = 'Basic ' + Buffer.from(`${f5_username}:${f5_password}`).toString('base64');
  const headers = { 'Content-Type': 'application/json', Authorization: auth };

  if (ENABLE_F5_LOG) {
    console.log(`\n----- F5 (UTIL) REQUEST -----`);
    console.log(`Method: ${method}`);
    console.log(`URL   : ${url}`);
    if (body) console.log(`Request Body: ${JSON.stringify(body, null, 2)}`);
  }

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
    console.error("底层 fetch 调用出错（UTIL 路径）：", err);
    throw new Error(`fetch failed: ${err.message}`);
  }

  if (ENABLE_F5_LOG) {
    console.log(`Response Status: ${resp.status} ${resp.statusText}`);
    // 抓包结果可能很长，日志里截断一下防止刷屏
    const logText = respText.length > 2000 ? respText.substring(0, 2000) + '... (truncated)' : respText;
    console.log(`Response Body  : ${logText || '<empty>'}`);
    console.log(`----- END F5 (UTIL) REQUEST -----\n`);
  }

  if (!resp.ok) {
    throw new Error(`F5 UTIL API ${method} ${path} failed: ${respText}`);
  }
  if (!respText) return null;

  try {
    return JSON.parse(respText);
  } catch {
    return null;
  }
}


// ===== ASM 模块专用请求函数 =====
async function f5RequestAsm(method, path, body, opts) {
  const { f5_url, f5_username, f5_password } = opts;
  const url = `${f5_url}/mgmt/tm/asm${path}`; // 注意前缀是 /mgmt/tm/asm
  const auth = 'Basic ' + Buffer.from(`${f5_username}:${f5_password}`).toString('base64');
  const headers = { 'Content-Type': 'application/json', Authorization: auth };

  if (ENABLE_F5_LOG) {
    console.log(`\n----- F5 (ASM) REQUEST -----`);
    console.log(`Method: ${method} URL: ${url}`);
  }

  try {
    const resp = await fetch(url, {
      method,
      headers,
      agent: httpsAgent,
      body: body ? JSON.stringify(body) : null
    });
    const respText = await resp.text();

    if (ENABLE_F5_LOG) {
      console.log(`Status: ${resp.status}`);
      // 日志截断，防止 log 太长
      console.log(`Body: ${respText.length > 500 ? respText.substring(0, 500) + '...' : respText}`);
      console.log(`----- END ASM REQUEST -----\n`);
    }

    if (!resp.ok) {
      throw new Error(`ASM API Error ${resp.status}: ${respText}`);
    }
    return JSON.parse(respText);
  } catch (err) {
    console.error("ASM Request Failed:", err);
    throw new Error(`ASM request failed: ${err.message}`);
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

// 1. 清洗数据
  let cleanText = cleanF5LogResponse(logs);

  return {
    content: [{
      type: 'text',
      text: `LTM Logs from ${start_time} to ${end_time}:\n${cleanText}`
    }]
  };
}

async function runGetAuditLogs(opts) {
  const { start_time, end_time } = opts;
  if (!start_time || !end_time) {
    throw new Error('Missing start_time or end_time');
  }
  const range = `${start_time}--${end_time}`;
  // F5 API path for audit logs: /mgmt/tm/sys/log/audit/stats
  // f5RequestSys automatically prepends /mgmt/tm/sys
  const path = `/log/audit/stats?options=range,${encodeURIComponent(range)}`;
  const logs = await f5RequestSys('GET', path, null, opts);

  // 1. 清洗数据
  let cleanText = cleanF5LogResponse(logs);

  // 2. 长度截断保护 (例如保留最后 50,000 字符，约 15k tokens)
  const MAX_CHARS = 60000;

  if (cleanText.length > MAX_CHARS) {
    cleanText = `... (logs truncated, showing last ${MAX_CHARS} chars) ...\n` + cleanText.slice(-MAX_CHARS);
  }

  return {
    content: [{
      type: 'text',
      text: `Audit Logs from ${start_time} to ${end_time}:\n${cleanText}`
    }]
  };
}

async function runGetSystemLogs(opts) {
  const { start_time, end_time } = opts;
  if (!start_time || !end_time) {
    throw new Error('Missing start_time or end_time');
  }
  const range = `${start_time}--${end_time}`;
  // F5 API path for system logs (messages): /mgmt/tm/sys/log/system/stats
  // This corresponds to "tmsh show sys log system"
  const path = `/log/system/stats?options=range,${encodeURIComponent(range)}`;
  const logs = await f5RequestSys('GET', path, null, opts);
  return {
    content: [{
      type: 'text',
      text: `System Logs from ${start_time} to ${end_time}:\n${JSON.stringify(logs, null, 2)}`
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



async function runTcpdump(opts) {
  const { f5_url, f5_username, f5_password, interface_name, filter, count, duration } = opts;
  
  // 参数默认值处理
  const iface = interface_name || '0.0'; // 默认为所有接口
  const pktCount = count || 20;          // 默认只抓20个包，防止响应过大
  const maxSeconds = duration || 10;     // 默认抓10秒，超时自动停止
  const tcpdumpFilter = filter || '';

  // 构建 bash 命令
  // -n: 不解析主机名
  // -nn: 不解析端口名
  // -v: 详细信息
  // -s0: 抓取完整包体
  // -X: 同时打印 Hex 和 ASCII (大模型分析 payload 必需)
  // timeout: Linux 命令，确保 tcpdump 不会死循环
  const cmdString = `timeout ${maxSeconds}s tcpdump -ni ${iface} -c ${pktCount} -s0 -nn -v -X ${tcpdumpFilter}`;

  console.log(`[Tcpdump] Executing: ${cmdString}`);

  // F5 Bash API 的 payload 格式
  const body = {
    command: 'run',
    utilCmdArgs: `-c '${cmdString}'`
  };

  try {
    // 调用 /mgmt/tm/util/bash
    const data = await f5RequestUtil('POST', '/bash', body, opts);
    
    // F5 bash 接口返回的结果通常在 commandResult 字段中
    let output = data?.commandResult || '';

    if (!output && data) {
        // 有时候结果可能直接在 JSON 结构里，视版本而定，做个兜底
        output = JSON.stringify(data);
    }

    return {
      content: [
        {
          type: 'text',
          text: `Tcpdump execution finished (Limit: ${pktCount} packets or ${maxSeconds}s).\nCommand: ${cmdString}\n\nResult:\n${output}`
        }
      ]
    };
  } catch (err) {
    return {
      content: [
        {
          type: 'text',
          text: `Error executing tcpdump: ${err.message}`
        }
      ]
    };
  }
}

// ===== 新增功能：查看 F5 配置 =====
async function runViewConfig(opts) {
  const { config_scope, specific_module } = opts;
  
  // 构造命令
  let cmdString = '';
  
  if (config_scope === 'saved_file') {
    // 查看硬盘上保存的默认 LTM 配置文件
    cmdString = 'cat /config/bigip.conf';
  } else if (config_scope === 'base_file') {
     // 查看硬盘上保存的基础网络配置文件
    cmdString = 'cat /config/bigip_base.conf';
  } else {
    // 默认为 tmsh list (内存中的运行配置)
    // 如果指定了模块 (如 ltm, net, sys)，则只显示该模块
    const module = specific_module ? specific_module : '';
    cmdString = `tmsh list ${module}`;
  }

  console.log(`[ViewConfig] Executing: ${cmdString}`);

  const body = {
    command: 'run',
    utilCmdArgs: `-c '${cmdString}'`
  };

  try {
    // 复用已有的 f5RequestUtil 工具函数
    const data = await f5RequestUtil('POST', '/bash', body, opts);
    
    // F5 bash 返回的内容通常在 commandResult 字段
    let output = data?.commandResult || '';

    // 防止输出为空的兜底
    if (!output && data) {
       output = "Command executed but returned no text (check if config is empty).";
    }

    const optimizedConfig = cleanF5ConfigResponse(output);
  
   //=== 新增：长度截断保护 (Config 依然可能很大，设个 300k 字符的安全线) ===
    const MAX_CONFIG_CHARS = 300000;
    let finalOutput = optimizedConfig;
    if (finalOutput.length > MAX_CONFIG_CHARS) {
        finalOutput = finalOutput.substring(0, MAX_CONFIG_CHARS) + "\n... (Configuration truncated due to length) ...";
    }


    return {
      content: [
        {
          type: 'text',
          text: `Configuration Output (${config_scope || specific_module || 'full'}):\n(Auto-optimized for LLM analysis)\n\n${output}`
        }
      ]
    };
  } catch (err) {
    return {
      content: [
        {
          type: 'text',
          text: `Error viewing config: ${err.message}`
        }
      ]
    };
  }
}

// ===== 新增：获取 License 信息 =====
async function runGetLicenseStatus(opts) {
  const { f5_url, f5_username, f5_password } = opts;
  if (!f5_url || !f5_username || !f5_password) {
    throw new Error('Missing f5_url, f5_username or f5_password');
  }

  // 调用 /mgmt/tm/sys/license
  const data = await f5RequestSys('GET', '/provision', null, opts);

  // 提取关键信息以方便大模型阅读
  // F5 API 返回的 activeModules 通常是一个列表
  const registrationKey = data?.registrationKey || 'N/A';
  const activeModules = data?.activeModules || [];
  
  // 构造可读性更好的摘要
  const summary = `Registration Key: ${registrationKey}\nActive Modules Count: ${activeModules.length}`;

  return {
    content: [
      {
        type: 'text',
        text: `License Status:\n${summary}\n\nActive Modules List:\n${JSON.stringify(activeModules, null, 2)}\n\nFull Raw Data:\n${JSON.stringify(data, null, 2)}`
      }
    ]
  };
}



// ===== 清洗 F5 日志数据  =====
function cleanF5LogResponse(f5Json) {
  if (!f5Json) return "No logs found.";

  // 直接在 apiRawValues.apiAnonymous 中包含完整日志
  if (f5Json.apiRawValues && f5Json.apiRawValues.apiAnonymous) {
    let rawLogs = f5Json.apiRawValues.apiAnonymous;
    // 去除首尾的空白字符
    return rawLogs.trim();
  }

  // 2. 兼容处理：如果返回的是 nestedStats 结构
  if (f5Json.entries) {
    const entries = Object.values(f5Json.entries);
    const cleanedLogs = entries.map(entry => {
      const nested = entry.nestedStats && entry.nestedStats.entries;
      if (!nested) return null;
      // 尝试提取描述信息
      return nested.logContent?.description || nested.description || null;
    }).filter(item => item !== null);

    return cleanedLogs.join('\n');
  }

  // 3. 兜底：如果都不是，为了调试，只返回部分原始 JSON
  return "Unknown log format. First 500 chars: " + JSON.stringify(f5Json).substring(0, 500);
}


// ===== 辅助函数：智能移除 F5 配置块 (v2.0 修复版) =====
// 这个函数通过计算 '{' 和 '}' 的数量来安全移除整个块，支持多层嵌套
function removeBlock(text, blockStartKeyword) {
  let startIndex = 0;
  while (true) {
    // 查找关键字的位置
    startIndex = text.indexOf(blockStartKeyword, startIndex);
    if (startIndex === -1) break;

    // 找到该关键字后的第一个 '{'
    const openBraceIndex = text.indexOf('{', startIndex);
    if (openBraceIndex === -1) {
      // 如果只有关键字没有 '{'，可能是误报，跳过
      startIndex += blockStartKeyword.length;
      continue;
    }

    // 开始计数：遇到 { 加 1，遇到 } 减 1
    let balance = 1;
    let currentIndex = openBraceIndex + 1;
    
    while (currentIndex < text.length && balance > 0) {
      const char = text[currentIndex];
      if (char === '{') balance++;
      else if (char === '}') balance--;
      currentIndex++;
    }

    // 如果平衡归零，说明找到了完整的块
    if (balance === 0) {
      // 这里的 cutEndIndex 是闭合 '}' 的下一个位置
      const before = text.substring(0, startIndex);
      // 检查后面是否有换行符，顺便删掉
      let cutEndIndex = currentIndex;
      if (text[cutEndIndex] === '\n') cutEndIndex++; 
      
      const after = text.substring(cutEndIndex);
      
      // 更新文本
      text = before + after;
      // 重置 startIndex 继续查找下一个同名块
      startIndex = 0; 
    } else {
      // 没找到闭合（可能是文本截断了），跳过
      startIndex += blockStartKeyword.length;
    }
  }
  return text;
}

// ===== 主清洗函数 =====
function cleanF5ConfigResponse(configText) {
  if (!configText) return "";
  let cleaned = configText;

  // 1. 【安全移除】使用计数器移除复杂嵌套块 (彻底解决结构断裂问题)
  // 这些是你在输出中看到的大段无用信息
  cleaned = removeBlock(cleaned, "sys diags ihealth-request");
  cleaned = removeBlock(cleaned, "sys snmp"); 
  cleaned = removeBlock(cleaned, "sys software volume");
  cleaned = removeBlock(cleaned, "sys disk logical-disk");
  cleaned = removeBlock(cleaned, "sys software update");
  cleaned = removeBlock(cleaned, "sys management-dhcp"); // 你输出里不需要这个
  cleaned = removeBlock(cleaned, "sys ecm cloud-provider"); // 云环境模板，通常不需要
  cleaned = removeBlock(cleaned, "sys management-ovsdb"); 

  // 2. 【增强版】移除空配置块 (Iterative Regex)
  // 匹配 "sys core { }" 这种里面什么都没有，或者只有空格的块
  // 运行 5 次以处理多层空嵌套 (比如 A { B { } } -> A { } -> 空)
  const emptyBlockRegex = /^\s*[^\s{]+\s*[^\s{]*\s*\{\s*\}\n?/gm;
  for(let i=0; i<5; i++) {
      cleaned = cleaned.replace(emptyBlockRegex, '');
  }

  // 3. 【降噪】移除具体的证书指纹/校验和 (保持单行正则)
  cleaned = cleaned.replace(/^\s*(checksum|fingerprint|signature|modulus|public-key|enc-key|passphrase)\s+.*$/gm, '');

  // 4. 【压缩】压缩连续空行，让 Token 更紧凑
  cleaned = cleaned.replace(/\n\s*\n/g, '\n');

  return cleaned.trim();
}


// ==========================================
// AWAF 工具 1: List AWAF Policies (列出策略)
// ==========================================
async function runListAwafPolicies(opts) {
  const { f5_url, f5_username, f5_password } = opts;

  // 复用 f5RequestUtil 执行 bash 命令
  const runBash = async (command) => {
    const body = { command: "run", utilCmdArgs: `-c "${command}"` };
    if (ENABLE_F5_LOG) console.log(`[List Policy] Executing: ${command}`);
    const data = await f5RequestUtil('POST', '/bash', body, opts);
    return data?.commandResult || "";
  };

  try {
    // 使用 one-line 模式，输出精简，方便模型快速浏览
    // awk '{print $3}' 是为了只提取策略名(可选优化)，但保留完整 one-line 更稳妥
    const output = await runBash(`tmsh list asm policy one-line`);
    
    if (!output || output.trim().length === 0) {
      return { content: [{ type: 'text', text: "No ASM policies found." }] };
    }

    return {
      content: [{
        type: 'text',
        text: `Available AWAF Policies (Raw TMSH Output):\n\n${output}`
      }]
    };
  } catch (err) {
    console.error("ListAwafPolicies Error:", err);
    return { isError: true, content: [{ type: 'text', text: `Failed to list policies: ${err.message}` }] };
  }
}

// ==========================================
// AWAF 工具 2: View Policy Config (查看策略详情 - Compact)
// ==========================================
async function runViewAwafPolicyConfig(opts) {
  const { policy_name, f5_url, f5_username, f5_password } = opts;

  if (!policy_name) {
    return { isError: true, content: [{ type: 'text', text: "Error: policy_name is required." }] };
  }

  const runBash = async (command) => {
    const body = { command: "run", utilCmdArgs: `-c "${command}"` };
    if (ENABLE_F5_LOG) console.log(`[View Config] Executing: ${command}`);
    
    const data = await f5RequestUtil('POST', '/bash', body, opts);
    return data?.commandResult || "";
  };

  try {
    // 1. 生成安全的文件名 (处理 /Common/ 前缀，避免路径错误)
    const safeName = policy_name.replace(/\//g, '_').replace(/[^a-zA-Z0-9_]/g, '');
    const tempFileName = `mcp_view_${safeName}_${Date.now()}.xml`;
    const tempFilePath = `/var/tmp/${tempFileName}`;

    console.log(`[View Config] Exporting ${policy_name} to ${tempFilePath} (min-xml-file)...`);

    // 2. 核心逻辑：Save (Compact) -> Read -> Delete
    // 使用 min-xml-file 参数获取极简配置（只包含修改项）
    // 使用 && 连接命令，确保顺序执行，原子性操作
    const commandChain = `tmsh save asm policy ${policy_name} min-xml-file ${tempFilePath} && cat ${tempFilePath} && rm -f ${tempFilePath}`;
    
    let xmlContent = await runBash(commandChain);

    if (!xmlContent || xmlContent.trim().length === 0) {
      return { 
        content: [{ 
          type: 'text', 
          text: `Error: No content returned. Please verify that the policy name '${policy_name}' is correct (check 'listAwafPolicies' output).` 
        }] 
      };
    }

    // 3. 截断保护 (虽然 min-xml 很小，但为了防止超大策略，还是加个保险)
    const MAX_CHARS = 500000;
    if (xmlContent.length > MAX_CHARS) {
      xmlContent = xmlContent.substring(0, MAX_CHARS) + `\n\n... [Truncated due to size limit] ...`;
    }

    return {
      content: [{
        type: 'text',
        text: `Configuration for '${policy_name}' (Compact XML):\n\n${xmlContent}`
      }]
    };

  } catch (err) {
    console.error("ViewAwafPolicyConfig Error:", err);
    return { isError: true, content: [{ type: 'text', text: `Operation failed: ${err.message}` }] };
  }
}


// ==========================================
// AWAF 工具 3: Get AWAF Event Logs (v4 URLSearchParams 终极修复版)
// ==========================================
async function runGetAwafEvents(opts) {
  const { top, filter_string } = opts;
  
  const limit = top ? top : 30;
  const params = new URLSearchParams();
  
  params.append('$orderby', 'time desc');
  params.append('$top', limit);
  params.append('$select', 'id,supportId,time,clientIp,geoIp,method,uri,responseCode,violationRating,isRequestBlocked,violations');


  if (filter_string) {
    params.append('$filter', filter_string);
  }

  const queryString = params.toString().replace(/\+/g, '%20');

  try {

    const data = await f5RequestAsm('GET', `/events/requests?${queryString}`, null, opts);   
    
    if (!data || !data.items || data.items.length === 0) {
      return { 
        content: [{ type: 'text', text: "No ASM event logs found matching the criteria." }] 
      };
    }
    const events = data.items.map(e => {
        let violationStr = "None (Clean Traffic)";
        if (e.violations && e.violations.length > 0) {
            violationStr = e.violations.map(v => {
                if (v.violationReference && v.violationReference.name) return v.violationReference.name;
                if (v.violationName) return v.violationName;
                return 'Unknown Violation';
            }).join(", ");
        }
        return {
            "Time": e.time || 'N/A',
            "Client IP": e.clientIp || 'N/A',
            "Location": e.geoIp || 'Internal/Unknown',
            "URI": e.uri ? `${e.method} ${e.uri}` : (e.method || 'Unknown Method'),
            "Status": e.responseCode || 'N/A',
            "Blocked": e.isRequestBlocked !== undefined ? e.isRequestBlocked : false,
            "Support ID": e.supportId || 'None',
            "Risk": (e.violationRating !== undefined && e.violationRating !== null) ? e.violationRating.toString() : '0',
            "Violations": violationStr
        };
    });

    return {
      content: [{
        type: 'text',
        text: `Found ${events.length} recent AWAF events:\n${JSON.stringify(events, null, 2)}`
      }]
    };

  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: `Failed to retrieve events: ${err.message}` }] };
  }
}




// ==========================================
// AWAF 工具 4: Get Single Event Detail (查看攻击详情/Payload)
// ==========================================
async function runGetAwafEventDetail(opts) {
  const { event_id } = opts;
  
  if (!event_id) {
    return { isError: true, content: [{ type: 'text', text: "Error: event_id is required." }] };
  }

  try {
    console.log(`[Event Detail] Fetching full details for ID: ${event_id}`);
    
    // 使用你验证过的 expandSubcollections=true 参数
    const data = await f5RequestAsm('GET', `/events/requests/${event_id}?expandSubcollections=true`, null, opts);
    
    if (!data || !data.id) {
      return { content: [{ type: 'text', text: `Error: Event ID '${event_id}' not found.` }] };
    }

    // === 智能提取核心证据 ===
    // 原始 JSON 太大，我们只提取对安全分析最有用的字段，防止 Token 浪费
    const analysisData = {
      "Time": data.requestDatetime,
      "Client": `${data.clientIp}:${data.clientPort}`,
      "Target": `${data.method} ${data.url}`,
      "Action": data.enforcementState?.isBlocked ? "🛑 BLOCKED" : "✅ PASSED",
      "Risk Score": data.enforcementState?.rating,
      "Attack Types": data.enforcementState?.attackTypeReferences 
                      ? data.enforcementState.attackTypeReferences.map(a => a.name).join(', ') 
                      : "None",
      // 提取违规名称
      "Violations": data.violations 
                    ? data.violations.map(v => v.violationReference?.name || "Unknown").join(', ') 
                    : "None",
      // 🌟 最关键的：原始攻击包（Payload）
      "Raw_Request_Payload": data.rawRequest?.httpRequestUnescaped || "Not captured (size limit or setting)"
    };

    return {
      content: [{
        type: 'text',
        text: `Attack Evidence for Event ${event_id}:\n${JSON.stringify(analysisData, null, 2)}`
      }]
    };

  } catch (err) {
    console.error("EventDetail Error:", err);
    return { isError: true, content: [{ type: 'text', text: `Failed to get event details: ${err.message}` }] };
  }
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
    description: 'this tool is used to set a pool member status to enable or disable, not used to configuration a pool member ',
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
},{
    name: 'runTcpdump',
    description: 'Run tcpdump on F5 to capture packets and analyze traffic content. ' + 
                 'It uses "timeout" to prevent hanging if no traffic matches. ' +
                 'Returns Hex/ASCII output (-X) suitable for LLM analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        f5_url:         { type: 'string', description: 'F5 management URL' },
        f5_username:    { type: 'string', description: 'F5 username' },
        f5_password:    { type: 'string', description: 'F5 password' },
        interface_name: { type: 'string', description: 'Interface to listen on (default: 0.0 for all)' },
        filter:         { type: 'string', description: 'Standard pcap filter string (e.g. "host 1.1.1.1 and port 80")' },
        count:          { type: 'integer', description: 'Max packet count (default: 20)' },
        duration:       { type: 'integer', description: 'Max duration in seconds (default: 10)' }
      },
      required: ['f5_url', 'f5_username', 'f5_password'],
      additionalProperties: false
    },
    handler: runTcpdump
  },{
    name: 'viewConfig',
    description: 'Retrieve and analyze F5 LTM configuration files to audit network and application settings. \n' +
                 'Files content explanation:\n' +
                 '- **running_config (tmsh list)**: The active configuration currently in memory. This is what is processing traffic NOW.\n' +
                 '- **saved_ltm_file (/config/bigip.conf)**: Contains high-level traffic management objects: Virtual Servers, Pools, Monitors, Profiles, and iRules.\n' +
                 '- **saved_base_file (/config/bigip_base.conf)**: Contains infrastructure settings: VLANs, Self IPs, Management IP, Routes, and Interface settings.\n\n' +
                 'CRITICAL CONFIGURATION CHECKLIST:\n' +
                 '1. **OneConnect & HTTP Dependency**: If a Virtual Server has a "OneConnect" profile configured to optimize connection reuse, it **MUST** also have an "HTTP" (or HTTPS) profile configured. OneConnect operates at Layer 7 and requires HTTP header parsing to function correctly.\n' +
                 '2. **SNAT Configuration**: Check if "source-address-translation" is set to "automap" or a specific SNAT pool to ensure return traffic routing.\n' +
                 '3. **Monitor Status**: Verify pools have active monitors attached for health checking.',
    inputSchema: {
      type: 'object',
      properties: {
        f5_url:         { type: 'string', description: 'F5 management URL' },
        f5_username:    { type: 'string', description: 'F5 username' },
        f5_password:    { type: 'string', description: 'F5 password' },
        config_scope:   { 
          type: 'string', 
          enum: ['running_config', 'saved_ltm_file', 'saved_base_file'],
          description: 'Choose "running_config" for active memory config, "saved_ltm_file" for bigip.conf (LTM objects), "saved_base_file" for bigip_base.conf (Network objects).' 
        },
        specific_module: { 
          type: 'string', 
          description: 'Optional (only for running_config). Filter by module, e.g., "ltm", "net", "sys", "ltm virtual", "ltm pool". Leave empty for full config.' 
        }
      },
      required: ['f5_url', 'f5_username', 'f5_password', 'config_scope'],
      additionalProperties: false
    },
    handler: runViewConfig
  },{
    name: 'getLicenseStatus',
    description: 'Retrieve the F5 device license status (e.g., LTM, ASM, APM, GTM). \n' +
    '"level": "none" = license is not enable and "level": "nominal" = license is enable' ,
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
    handler: runGetLicenseStatus
  },{
    name: 'getAuditLogs',
    description: 'Retrieve Audit logs (/var/log/audit) within a specified time range via /mgmt/tm/sys/log/audit \n' +
    'The audit event messages are messages that the BIG-IP system logs as a result of changes to the BIG-IP system configuration',
    inputSchema: {
      type: 'object',
      properties: {
        f5_url:       { type: 'string', description: 'F5 management URL' },
        f5_username:  { type: 'string', description: 'F5 username' },
        f5_password:  { type: 'string', description: 'F5 password' },
        start_time:   { type: 'string', description: 'ISO timestamp for range start, e.g. 2025-05-30T00:00:00Z' },
        end_time:     { type: 'string', description: 'ISO timestamp for range end, e.g. 2025-05-30T15:00:00Z' }
      },
      required: ['f5_url','f5_username','f5_password','start_time','end_time'],
      additionalProperties: false
    },
    handler: runGetAuditLogs
  },
  {
    name: 'getSystemLogs',
    description: 'Retrieve System logs (/var/log/messages) within a specified time range via /mgmt/tm/sys/log/system\n'+
    'The system event messages are based on global Linux events, and are not specific to BIG-IP local traffic management events.',
    inputSchema: {
      type: 'object',
      properties: {
        f5_url:       { type: 'string', description: 'F5 management URL' },
        f5_username:  { type: 'string', description: 'F5 username' },
        f5_password:  { type: 'string', description: 'F5 password' },
        start_time:   { type: 'string', description: 'ISO timestamp for range start, e.g. 2025-05-30T00:00:00Z' },
        end_time:     { type: 'string', description: 'ISO timestamp for range end, e.g. 2025-05-30T15:00:00Z' }
      },
      required: ['f5_url','f5_username','f5_password','start_time','end_time'],
      additionalProperties: false
    },
    handler: runGetSystemLogs
  },{
    name: 'listAwafPolicies',
    description: 'List all available F5 ASM (AWAF) policies on the device. \n' +
                 'CRITICAL INSTRUCTION: Always run this tool FIRST to verify the policy name before using "viewAwafPolicyConfig". \n',
    inputSchema: {
      type: 'object',
      properties: {
        f5_url:      { type: 'string', description: 'F5 management URL' },
        f5_username: { type: 'string', description: 'F5 username' },
        f5_password: { type: 'string', description: 'F5 password' }
      },
      required: ['f5_url', 'f5_username', 'f5_password'],
      additionalProperties: false
    },
    handler: runListAwafPolicies
  },
  {
    name: 'viewAwafPolicyConfig',
    description: 'Retrieve the detailed configuration of a SPECIFIC ASM policy in Compact XML format. \n',
    inputSchema: {
      type: 'object',
      properties: {
        f5_url:      { type: 'string', description: 'F5 management URL' },
        f5_username: { type: 'string', description: 'F5 username' },
        f5_password: { type: 'string', description: 'F5 password' },
        policy_name: { 
          type: 'string', 
          description: 'The EXACT full path of the policy (e.g. /Common/waftest). Use "listAwafPolicies" to find this.' 
        }
      },
      required: ['f5_url', 'f5_username', 'f5_password', 'policy_name'],
      additionalProperties: false
    },
    handler: runViewAwafPolicyConfig
  },{
    name: 'getAwafAttackLog',
    description: 'Retrieve and analyze F5 AWAF (ASM) security event logs. \n' +
                 'Returns a summary of recent attacks including Client IP, Violation Type, and Blocking Status.',
    inputSchema: {
      type: 'object',
      properties: {
        f5_url:      { type: 'string', description: 'F5 management URL' },
        f5_username: { type: 'string', description: 'F5 username' },
        f5_password: { type: 'string', description: 'F5 password' },
        top:         { type: 'integer', description: 'Number of logs to retrieve (Default: 30). Keep it small to save tokens.' },
        filter_string: { 
          type: 'string', 
          description: 'OData filter string to search for specific attacks. \n' +
                       '*** AVAILABLE FIELDS ***: \n' +
                       '- violationRating (1-5, where 5 is critical)\n' +
                       '- time (format: YYYY-MM-DDThh:mm:ssZ, e.g., \'2026-01-21T00:00:00Z\')\n' +
                       '- clientIp\n' +
                       '- isRequestBlocked (true/false)\n' +
                       '- supportId\n\n' +
                       '*** EXAMPLES ***:\n' +
                       '- High Risk Today: "violationRating ge 4 and time ge \'2026-01-21T00:00:00Z\'"\n' +
                       '- Specific IP: "clientIp eq \'192.168.1.5\'"\n' +
                       '- Blocked Only: "isRequestBlocked eq true"'
        }
      },
      required: ['f5_url', 'f5_username', 'f5_password'],
      additionalProperties: false
    },
    handler: runGetAwafEvents
  },{
    name: 'getAwafEventDetail',
    description: 'Retrieve the FULL details (including raw HTTP request payload) for a specific AWAF event ID. \n' +
                 'PREREQUISITE: You MUST run "getAwafAttackLog" first to get the "id" (Support ID is NOT the event ID). \n' +
                 'Use this to inspect the actual attack payload (e.g., SQL injection strings, XSS scripts) to determine if it is a false positive.',
    inputSchema: {
      type: 'object',
      properties: {
        f5_url:      { type: 'string', description: 'F5 management URL' },
        f5_username: { type: 'string', description: 'F5 username' },
        f5_password: { type: 'string', description: 'F5 password' },
        event_id:    { 
          type: 'string', 
          description: 'The numeric Event ID (e.g., "2078111447904211732"). Obtain this from "getAwafAttackLog".' 
        }
      },
      required: ['f5_url', 'f5_username', 'f5_password', 'event_id'],
      additionalProperties: false
    },
    handler: runGetAwafEventDetail
  }
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


// ===== 核心 MCP 处理器 (修复版) =====
app.post('/', async (req, res) => {
  const { jsonrpc, id, method, params } = req.body;

  // 1. 基础校验
  if (jsonrpc !== '2.0') {
    return res.status(400).json({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request' } });
  }

  // 打印日志方便调试
  console.log(`[MCP Request] Method: ${method}, ID: ${id}`);

  try {
    // -------------------------------------------------------
    // 修复点 1: 标准化 Initialize 响应
    // -------------------------------------------------------
    if (method === 'initialize') {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05', // 使用标准版本号
          capabilities: {
            tools: {},    // 【重要】告诉 Client 我支持工具
            logging: {}   // 可选：告诉 Client 我支持发日志
          },
          serverInfo: {
            name: "f5McpServer",
            version: "1.0.0"
          }
        }
      });
    }

    // -------------------------------------------------------
    // 修复点 2: 处理 notifications/initialized
    // -------------------------------------------------------
    if (method === 'notifications/initialized') {
      // 这是通知，不需要返回 result，但在 HTTP 中我们需要结束请求
      // 返回 200 OK 即可，Client 收到这就知道握手成功了
      return res.status(200).end();
    }

    // -------------------------------------------------------
    // 修复点 3: 使用标准方法名 tools/list
    // -------------------------------------------------------
    if (method === 'tools/list') {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          tools: tools.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema
          }))
        }
      });
    }

    // -------------------------------------------------------
    // 修复点 4: 使用标准方法名 tools/call
    // -------------------------------------------------------
    if (method === 'tools/call') {
      const { name, arguments: args } = params || {};
      const tool = tools.find(t => t.name === name);

      if (!tool) {
        return res.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Tool not found: ${name}` }
        });
      }

      try {
        const result = await tool.handler(args || {});
        return res.json({
          jsonrpc: '2.0',
          id,
          result: result
        });
      } catch (toolError) {
        return res.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32000, message: toolError.message }
        });
      }
    }

    // -------------------------------------------------------
    // 修复点 5: 优雅处理 Ping 和 未知方法
    // -------------------------------------------------------
    if (method === 'ping') {
      return res.json({ jsonrpc: '2.0', id, result: {} });
    }

    // 对于 Client 瞎猜的 prompts/list 或 resources/list，
    // 因为我们在 capabilities 里没声明，这里返回 Method not found 是正确的。
    // 只要上面 capabilities 改对了，Client 通常就不会发这些了。
    console.warn(`[MCP Warning] Method not supported: ${method}`);
    return res.json({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` }
    });

  } catch (err) {
    console.error("Server Error:", err);
    return res.status(500).json({
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: 'Internal error' }
    });
  }
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