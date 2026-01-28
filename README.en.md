# F5 MCP Server

> An MCP (Model Context Protocol) Server for F5 BIG-IP  
> Exposes F5 iControl REST APIs as **LLM-callable tools**, enabling Agentic AI to operate BIG-IP programmatically.

---

## 1. Project Overview

**F5 MCP Server** is an MCP Server implemented with **Node.js + Express**, designed to wrap F5 BIG-IP iControl REST APIs as MCP tools.
This allows LLMs / AI Agents to interact with F5 devices in a secure, structured, and tool-driven manner.

> **Update:** A Python-based implementation has recently been added, with the file name **`server.py`**.

Key Problems This Project Addresses
- 🔧 **Expose BIG-IP REST APIs as LLM-callable tools** ，Transform low-level iControl REST endpoints into well-defined MCP tools that AI agents can safely invoke.
- 🤖 **Enable Agentic AI for automated network & application delivery operations**，Allow AI agents to perform operational tasks such as configuration, inspection, and troubleshooting on F5 devices.
- 🔌 Seamless integration with MCP clients **Cherry Studio / Claude Desktop / OpenAI MCP Client**
- 🧠 Help AI understand F5 capability boundaries


---

## 2. Architecture

LLM Agent ---mcp-- F5 MCP server(nodejs) -- rest api--- F5 LTM

---

## 3. Env

- Node.js **>= 18**
- F5 BIG-IP LTM



---

## 4. launch F5 MCP Server
### 4.1 launch F5 MCP Server （nodejs）
- run local：
```bash
node server.js
```
- npx：
```bash 
npx -y git+https://gitee.com/xtomrfx/f5-mcp.git --port=3000 (default port is 3000，use --port to define)
```

### 4.2 launch F5 MCP Server（Docker）:

- Clone the repository：
```
git clone https://gitee.com/xtomrfx/f5-mcp.git
cd f5-mcp
```
- Build & run with docker-compose (Method 1):
```
docker-compose up -d
```
The service will listen on port 3000 by default.

- Build & run with Docker CLI (Method 2):
```
docker build -t f5-mcp-server .
docker run -d -p 3000:3000 --name f5-mcp f5-mcp-server
```

---
## 5. install F5 MCP Server to Agent

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

## F5 MCP Tools Capability Matrix

This MCP Server exposes the following F5 BIG-IP capabilities as tools for AI Agents.  （keep on adding more tools ）

## 1. Local Traffic Manager (LTM)
Tools for managing Virtual Servers, Pools, Members, and iRules.

| Tool Name | Description | Key Parameters |
| :--- | :--- | :--- |
| **`listAllVirtual`** | Lists all Virtual Servers on the device, including status, destination IP:Port, and attached pools. | `None` |
| **`createVirtualServer`** | Creates a new standard TCP Virtual Server and optionally binds it to an existing pool. | `virtual_name`, `ip`, `port`, `pool_name` |
| **`deleteVirtualServer`** | Deletes a specified Virtual Server. | `virtual_name` |
| **`listAllPool`** | Lists all Load Balancing Pools with their monitor status and member details. | `None` |
| **`configurePool`** | Creates a new Pool and adds initial members. | `pool_name`, `members` (array of ip/port) |
| **`deletePool`** | Deletes an entire Pool. | `pool_name` |
| **`getPoolMemberStatus`** | Retrieves the health status (Up/Down) of all members in a specific pool. | `pool_name` |
| **`removeMember`** | Removes a specific member from a pool. | `pool_name`, `member_address`, `member_port` |
| **`updateMemberStat`** | **Enables or Disables** a pool member (Session state). Useful for maintenance or canary deployment. | `pool_name`, `member_address`, `action` ('enable'/'disable') |
| **`addIrules`** | Uploads and creates a new iRule script on the device. | `irule_name`, `irule_code` |

## 2. System Diagnostics & Observability
Tools for device health monitoring, configuration auditing, and deep-dive troubleshooting.

| Tool Name | Description | Key Features |
| :--- | :--- | :--- |
| **`viewConfig`** | Retrieves configuration snapshots. Supports `running_config` (tmsh list), `saved_ltm_file` (bigip.conf), and `saved_base_file` (network). | Auto-truncates large configs; Filter by module (e.g. `ltm`, `net`). |
| **`runViewInterfaceConfig`** | A lightweight alternative to `viewConfig` specifically for Network/VLAN/Self-IP settings. | Executes `tmsh list net one-line`. |
| **`runTcpdump`** | Executes `tcpdump` on the device to capture traffic. | Returns **Hex/ASCII** (-X) output for LLM analysis. Includes timeout protection. |
| **`getLtmLogs`** | Retrieves `/var/log/ltm` logs within a time range. | **Smart Collapse Mode**: Summarizes repetitive logs to save tokens. |
| **`getAuditLogs`** | Retrieves `/var/log/audit` logs for tracking configuration changes. | **PID Masking**: Groups user actions and system scripts intelligently. |
| **`getSystemLogs`** | Retrieves `/var/log/messages` (System-level Linux events). | Standard syslog retrieval. |
| **`getCpuStat`** | Retrieves CPU usage statistics. | Distinguishes between Control Plane and Data Plane (TMM) cores. |
| **`getTmmInfo`** | Retrieves detailed TMM (Traffic Management Microkernel) resource usage. | Monitors memory and core utilization. |
| **`runGetConnection`** | Retrieves global connection statistics. | Active Client/Server connections, SSL sessions. |
| **`runGetCertificateStat`** | Retrieves SSL Certificate statistics. | Helps identify expired or failing certificates. |
| **`getLicenseStatus`** | Checks device license status and active modules (LTM, ASM, etc.). | Returns Registration Key and active flags. |

## 3. Security (AWAF / ASM)
Tools for Web Application Firewall policy management and attack investigation.

| Tool Name | Description | Key Features |
| :--- | :--- | :--- |
| **`listAwafPolicies`** | Lists all available ASM (AWAF) security policies. | Returns raw TMSH output for policy discovery. |
| **`viewAwafPolicyConfig`** | Exports the configuration of a specific policy in Compact XML format. | Used to audit WAF rules and settings. |
| **`getAwafAttackLog`** | Retrieves recent security incidents/attacks using OData filters. | Filter by `violationRating`, `clientIp`, `time`, etc. |
| **`getAwafEventDetail`** | Retrieves full details for a specific Attack Event ID. | **Forensics**: Returns the full HTTP Payload, violations, and attack signature evidence. |