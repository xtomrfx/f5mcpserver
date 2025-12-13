# F5 MCP Server

> An MCP (Model Context Protocol) Server for F5 BIG-IP  
> Exposes F5 iControl REST APIs as **LLM-callable tools**, enabling Agentic AI to operate BIG-IP programmatically.

---

## 1. 项目简介

**F5 MCP Server** 是一个基于 **Node.js + Express** 实现的 MCP Server，用于将 **F5 BIG-IP iControl REST API** 封装为 MCP 工具（tools），从而让 **LLM / AI Agent** 以“工具调用”的方式安全、结构化地操作 F5 设备。

该项目主要解决的问题：

- 🔧 将 BIG-IP 的 REST API 转换为 **LLM 可调用工具**
- 🤖 支持 **Agentic AI** 自动执行网络与应用交付运维操作
- 🔌 可无缝集成 **Cherry Studio / Claude Desktop / OpenAI MCP Client**
- 🧠 让 AI 理解 F5 能力边界，而不是“直接写 REST”

---

## 2. 架构概览

┌─────────────┐
│ LLM / │
│ AI Agent │
└─────┬───────┘
│ MCP
┌─────▼───────┐
│ F5 MCP │
│ Server │ (Node.js / Express)
└─────┬───────┘
│ iControl REST
┌─────▼───────┐
│ F5 BIG-IP │
│ LTM / APM │
└─────────────┘




