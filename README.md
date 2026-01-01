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
      "endpoints": {
        "listTools": "/mcp/list-tools",
        "invoke":    "/mcp/invoke"
      }
    }
  }
}



