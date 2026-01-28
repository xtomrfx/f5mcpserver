# F5 MCP Server

> An MCP (Model Context Protocol) Server for F5 BIG-IP  
> Exposes F5 iControl REST APIs as **LLM-callable tools**, enabling Agentic AI to operate BIG-IP programmatically.

---

## 1. 项目简介

**F5 MCP Server** 是一个基于 **Node.js + Express** 实现的 MCP Server，用于将 **F5 BIG-IP iControl REST API** 封装为 MCP 工具（tools），从而让 **LLM / AI Agent** 以“工具调用”的方式安全、结构化地操作 F5 设备。

最新更新了python的实现，文件名为 server.py

该项目主要解决的问
- 🔧 将 BIG-IP 的 REST API 转换为 **LLM 可调用工具**
- 🤖 支持 **Agentic AI** 自动执行网络与应用交付运维操作
- 🔌 可无缝集成 **Cherry Studio / Claude Desktop / OpenAI MCP Client**
- 🧠 让 AI 理解 F5 能力边界，而不是“直接写 REST”


---

## 2. 架构概览

LLM Agent ---mcp-- F5 MCP server(nodejs) -- rest api--- F5 LTM

---

## 3. 环境要求

- Node.js **>= 18**
- 可访问的 F5 BIG-IP 管理接口（HTTPS）
- BIG-IP 已开启 iControl REST


---

## 4. 运行F5 MCP Server
### 4.1 运行F5 MCP Server

- 本地运行：
```bash
node server.js
```
- npx运行：
```bash 
npx -y git+https://gitee.com/xtomrfx/f5-mcp.git --port=3000 (端口默认为3000，可以指定)
```

### 4.2 构建容器运行 F5 MCP Server (Docker Version)

- 克隆代码
```bash
   git clone https://gitee.com/xtomrfx/f5-mcp.git
```
- 构建镜像 （方法1）
```
   cd f5-mcp
```
```
  docker-compose up -d
```
服务启动后默认监听本地 3000 端口。

- 构建镜像 （方法2）
```
docker build -t f5-mcp-server .
docker run -d -p 3000:3000 --name f5-mcp f5-mcp-server
```


---
## 5. Agent加载F5 MCP Server

```json
{
  "mcpServers": {
    "f5ConfigServer": {
      "type": "streamableHttp",
      "url": "http://localhost:3000",
      "headers": {
        "Content-Type": "application/json",
        "Authorization": "Bearer token"
      }
    }
  }
}

```


---
# 🛠️ F5 MCP 工具能力矩阵 (F5 MCP Tools Capability Matrix)

本 MCP Server 将以下 F5 BIG-IP 核心功能封装为 AI Agent 可调用的工具。

## 1. 本地流量管理 (LTM)
用于管理 Virtual Servers、Pools、Members 和 iRules 的核心工具。

| 工具名称 (Tool Name) | 功能描述 | 关键参数/说明 |
| :--- | :--- | :--- |
| **`listAllVirtual`** | 列出设备上所有的 Virtual Server，包含状态、目标 IP:Port 和关联的 Pool。 | `无` |
| **`createVirtualServer`** | 创建一个新的标准 TCP Virtual Server，并可选择绑定现有的 Pool。 | `virtual_name`, `ip`, `port`, `pool_name` |
| **`deleteVirtualServer`** | 删除指定的 Virtual Server。 | `virtual_name` |
| **`listAllPool`** | 列出所有的负载均衡 Pool，包含健康检查状态和成员详情。 | `无` |
| **`configurePool`** | 创建一个新的 Pool 并批量添加初始成员 (Members)。 | `pool_name`, `members` (IP/Port 数组) |
| **`deletePool`** | 删除整个 Pool 对象。 | `pool_name` |
| **`getPoolMemberStatus`** | 查询指定 Pool 中所有成员的健康状态 (Up/Down)。 | `pool_name` |
| **`removeMember`** | 从 Pool 中移除特定的成员。 | `pool_name`, `member_address`, `member_port` |
| **`updateMemberStat`** | **启用或禁用** Pool 成员 (会话状态)。常用于服务器维护或金丝雀发布。 | `action` ('enable'/'disable') |
| **`addIrules`** | 上传并在设备上创建新的 iRule 脚本。 | `irule_name`, `irule_code` |

## 2. 系统诊断与可观测性 (System Diagnostics)
用于设备健康监控、配置审计和深度故障排查的工具。

| 工具名称 (Tool Name) | 功能描述 | 核心特性 |
| :--- | :--- | :--- |
| **`viewConfig`** | 获取配置快照。支持查看 `running_config` (内存运行配置)、`saved_ltm_file` (bigip.conf) 和 `saved_base_file` (网络基础配置)。 | 支持大配置自动截断；支持按模块过滤 (如 `ltm`, `net`)。 |
| **`runViewInterfaceConfig`** | `viewConfig` 的轻量级替代方案，专门用于查看网络接口、VLAN 和 Self-IP 配置。 | 执行 `tmsh list net one-line`。 |
| **`runTcpdump`** | 在设备上执行 `tcpdump` 进行抓包。 | 返回 **Hex/ASCII** (-X) 格式以便 LLM 分析；内置超时保护。 |
| **`getLtmLogs`** | 获取指定时间范围内的 `/var/log/ltm` 日志。 | **智能折叠模式**：自动摘要重复日志以节省 Token。 |
| **`getAuditLogs`** | 获取 `/var/log/audit` 审计日志，追踪配置变更。 | **PID 模糊化**：智能聚合用户操作和系统脚本日志。 |
| **`getSystemLogs`** | 获取 `/var/log/messages` (Linux 系统级事件)。 | 标准 Syslog 检索。 |
| **`getCpuStat`** | 获取 CPU 使用率统计。 | 区分控制平面 (Control Plane) 和数据平面 (TMM) 核心。 |
| **`getTmmInfo`** | 获取详细的 TMM (流量管理微内核) 资源使用情况。 | 监控内存和核心利用率，评估性能瓶颈。 |
| **`runGetConnection`** | 获取全局连接数统计信息。 | 包含活跃的 Client/Server 连接数及 SSL 会话数。 |
| **`runGetCertificateStat`** | 获取 SSL 证书统计信息。 | 帮助识别过期或握手失败的证书。 |
| **`getLicenseStatus`** | 检查设备 License 激活状态及模块 (LTM, ASM 等)。 | 返回注册码 (Registration Key) 和激活标志。 |

## 3. 应用安全 (AWAF / ASM)
用于 Web 应用防火墙策略管理和攻击溯源的工具。

| 工具名称 (Tool Name) | 功能描述 | 核心特性 |
| :--- | :--- | :--- |
| **`listAwafPolicies`** | 列出设备上所有可用的 ASM (AWAF) 安全策略。 | 返回 TMSH 原始输出，用于发现策略名称。 |
| **`viewAwafPolicyConfig`** | 以精简版 XML 格式导出特定策略的配置详情。 | 用于审计 WAF 规则集和配置项。 |
| **`getAwafAttackLog`** | 使用 OData 过滤器检索最近的安全事件/攻击日志。 | 支持按 `violationRating` (风险等级)、`clientIp`、`time` 等过滤。 |
| **`getAwafEventDetail`** | 获取特定攻击事件 ID 的完整详情。 | **取证核心**：返回完整的 HTTP Payload、违规项和攻击签名证据。 |