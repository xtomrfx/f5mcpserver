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
      "endpoints": {
        "listTools": "/mcp/list-tools",
        "invoke":    "/mcp/invoke"
      }
    }
  }
}



