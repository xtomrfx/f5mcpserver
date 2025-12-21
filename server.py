import argparse
import asyncio
import base64
import json
import logging
import os
import sys
from typing import Any, Dict, List, Optional, Union, Callable

import httpx
import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# ===== Configuration =====
# Toggle these to enable/disable logs
ENABLE_CLIENT_LOG = True
ENABLE_F5_LOG = True

# ===== Setup Logging =====
logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger("mcp_server")

app = FastAPI()

# ===== Models & Helpers =====

class Tool(BaseModel):
    name: str
    description: str
    inputSchema: Dict[str, Any]
    handler: Any = None # Helper to store the function

    class Config:
        arbitrary_types_allowed = True

def log_request(direction: str, method: str, url: str, body: Any):
    if not ENABLE_CLIENT_LOG and direction == "MCP": return
    if not ENABLE_F5_LOG and direction == "F5": return
    
    header = f"----- {direction} REQUEST -----"
    logger.info(f"\n{header}")
    logger.info(f"{method} {url}")
    if body:
        logger.info(f"Request Body: {json.dumps(body, indent=2)}")
    else:
        logger.info("Request Body: <empty>")

def log_response(direction: str, status: Any, body: Any):
    if not ENABLE_CLIENT_LOG and direction == "MCP": return
    if not ENABLE_F5_LOG and direction == "F5": return
    
    logger.info(f"Response Status: {status}")
    if body:
        # Try to parse JSON for pretty printing
        try:
            if isinstance(body, str):
                body_json = json.loads(body)
                logger.info(f"Response Body: {json.dumps(body_json, indent=2)}")
            else:
                logger.info(f"Response Body: {json.dumps(body, indent=2)}")
        except:
            logger.info(f"Response Body: {body}")
    else:
        logger.info("Response Body: <empty>")
    
    logger.info(f"----- END {direction} REQUEST -----\n")

# ===== F5 API Helpers =====

async def f5_request(method: str, path: str, opts: dict, body: dict = None, is_sys: bool = False):
    f5_url = opts.get('f5_url')
    f5_username = opts.get('f5_username')
    f5_password = opts.get('f5_password')
    
    if not f5_url or not f5_username or not f5_password:
         # Some tools might check this earlier, but safety first
         pass

    # Clean URL logic (ensure no double slashes if user input varies)
    base_url = f5_url.rstrip('/')
    module = 'sys' if is_sys else 'ltm'
    url = f"{base_url}/mgmt/tm/{module}{path}"
    
    headers = {
        "Content-Type": "application/json"
    }
    
    log_request("F5" + (" (SYS)" if is_sys else ""), method, url, body)

    async with httpx.AsyncClient(verify=False, timeout=30.0) as client:
        try:
            resp = await client.request(
                method=method,
                url=url,
                auth=(f5_username, f5_password),
                headers=headers,
                json=body if body else None
            )
            
            resp_text = resp.text
            
            log_response("F5" + (" (SYS)" if is_sys else ""), f"{resp.status_code} {resp.reason_phrase}", resp_text)
            
            if resp.is_error:
                raise Exception(f"F5 API {method} {path} failed: {resp_text}")
            
            if not resp_text:
                return None
                
            return json.loads(resp_text)
            
        except httpx.RequestError as e:
            logger.error(f"Underlying fetch error: {e}")
            raise Exception(f"fetch failed: {str(e)}")
        except json.JSONDecodeError:
            return None

async def f5_request_sys(method: str, path: str, body: dict, opts: dict):
    return await f5_request(method, path, opts, body, is_sys=True)

# ===== Tool Implementations =====

async def run_configure_pool(opts):
    pool_name = opts.get('pool_name')
    members = opts.get('members')
    if not pool_name or not isinstance(members, list):
        raise ValueError('Missing pool_name or members')
        
    # Create Pool
    await f5_request('POST', '/pool', opts, {'name': pool_name, 'partition': 'Common'})
    
    # Add Members
    for m in members:
        member_name = f"{m.get('address')}:{m.get('port')}"
        await f5_request(
            'POST',
            f"/pool/~Common~{pool_name}/members",
            opts,
            {'partition': 'Common', 'name': member_name, 'address': m.get('address')}
        )
    return {'content': [{'type': 'text', 'text': f"OK Pool '{pool_name}' created with {len(members)} members."}]}

async def run_remove_member(opts):
    pool_name = opts.get('pool_name')
    member_address = opts.get('member_address')
    member_port = opts.get('member_port')
    if not pool_name or not member_address or not member_port:
        raise ValueError('Missing pool_name, member_address or member_port')
        
    member_id = f"{member_address}:{member_port}"
    # F5 REST API typically requires encoding, httpx handles url encoding if passed in params, 
    # but here we construct the path manually.
    import urllib.parse
    encoded_pool = urllib.parse.quote(pool_name)
    encoded_id = urllib.parse.quote(member_id)
    
    await f5_request('DELETE', f"/pool/~Common~{encoded_pool}/members/{encoded_id}", opts)
    return {'content': [{'type': 'text', 'text': f"OK Removed member {member_id} from pool '{pool_name}'."}]}

async def run_delete_pool(opts):
    pool_name = opts.get('pool_name')
    if not pool_name: raise ValueError('Missing pool_name')
    import urllib.parse
    encoded_pool = urllib.parse.quote(pool_name)
    await f5_request('DELETE', f"/pool/{encoded_pool}", opts)
    return {'content': [{'type': 'text', 'text': f"OK Pool '{pool_name}' deleted."}]}

async def run_list_all_pool_stat(opts):
    if not all(k in opts for k in ['f5_url', 'f5_username', 'f5_password']):
        raise ValueError('Missing f5_url, f5_username or f5_password')
    data = await f5_request('GET', '/pool', opts)
    return {'content': [{'type': 'text', 'text': f"All Pools:\n{json.dumps(data, indent=2)}"}]}

async def run_create_virtual_server(opts):
    virtual_name = opts.get('virtual_name')
    ip = opts.get('ip')
    port = opts.get('port')
    pool_name = opts.get('pool_name')
    
    if not virtual_name or not ip or not port:
        raise ValueError('Missing virtual_name, ip or port')
        
    cfg = {
        'name': virtual_name,
        'destination': f"{ip}:{port}",
        'mask': '255.255.255.255',
        'ipProtocol': 'tcp',
        'profiles': [{'name': 'tcp'}]
    }
    if pool_name:
        cfg['pool'] = pool_name
        
    await f5_request('POST', '/virtual', opts, cfg)
    return {'content': [{'type': 'text', 'text': f"OK Virtual Server '{virtual_name}' created."}]}

async def run_delete_virtual_server(opts):
    virtual_name = opts.get('virtual_name')
    if not virtual_name: raise ValueError('Missing virtual_name')
    import urllib.parse
    encoded_name = urllib.parse.quote(virtual_name)
    await f5_request('DELETE', f"/virtual/~Common~{encoded_name}", opts)
    return {'content': [{'type': 'text', 'text': f"OK Virtual Server '{virtual_name}' deleted."}]}

async def run_get_pool_member_status(opts):
    pool_name = opts.get('pool_name')
    if not pool_name: raise ValueError('Missing pool_name')
    import urllib.parse
    encoded_pool = urllib.parse.quote(pool_name)
    
    stats = await f5_request('GET', f"/pool/~Common~{encoded_pool}/members/stats", opts)
    entries = stats.get('entries', {}) if stats else {}
    
    rows = []
    for e in entries.values():
        n = e.get('nestedStats', {}).get('entries', {})
        
        # Safe extraction
        addr_obj = n.get('addr') or n.get('address') or {}
        address = addr_obj.get('description', 'unknown')
        
        port_obj = n.get('port') or {}
        port = port_obj.get('value') or port_obj.get('description', 'unknown')
        
        avail_obj = n.get('status.availabilityState') or {}
        avail = avail_obj.get('description', 'unknown')
        
        status = 'up' if avail.lower() == 'available' else 'down'
        rows.append({'address': address, 'port': port, 'status': status})
        
    return {'content': [{'type': 'text', 'text': f"OK Pool '{pool_name}' members: {json.dumps(rows)}"}]}

async def run_get_ltm_logs(opts):
    start_time = opts.get('start_time')
    end_time = opts.get('end_time')
    if not start_time or not end_time: raise ValueError('Missing start_time or end_time')
    
    range_str = f"{start_time}--{end_time}"
    import urllib.parse
    path = f"/log/ltm/stats?options=range,{urllib.parse.quote(range_str)}"
    
    logs = await f5_request_sys('GET', path, None, opts)
    return {'content': [{'type': 'text', 'text': f"LTM Logs from {start_time} to {end_time}:\n{json.dumps(logs, indent=2)}"}]}

async def run_add_irules(opts):
    irule_name = opts.get('irule_name')
    irule_code = opts.get('irule_code')
    partition = opts.get('partition', 'Common')
    if not irule_name or not irule_code: raise ValueError('Missing irule_name or irule_code')
    
    body = {
        'name': irule_name,
        'partition': partition,
        'apiAnonymous': irule_code
    }
    await f5_request('POST', '/rule', opts, body)
    return {'content': [{'type': 'text', 'text': f"OK iRule '{irule_name}' created."}]}

async def run_update_member_stat(opts):
    pool_name = opts.get('pool_name')
    member_address = opts.get('member_address')
    member_port = opts.get('member_port')
    action = opts.get('action')
    
    if not all([pool_name, member_address, member_port, action]):
        raise ValueError('Missing required fields')
        
    import urllib.parse
    pool_fq = f"~Common~{urllib.parse.quote(pool_name)}"
    member_id = urllib.parse.quote(f"~Common~{member_address}:{member_port}")
    
    body = {
        'state': 'user-up',
        'session': 'user-enabled' if action == 'enable' else 'user-disabled'
    }
    
    await f5_request('PUT', f"/pool/{pool_fq}/members/{member_id}", opts, body)
    verb = 'enabled' if action == 'enable' else 'disabled'
    return {'content': [{'type': 'text', 'text': f"OK, member {member_address}:{member_port} {verb}."}]}

async def run_get_cpu_stat(opts):
    if not all(k in opts for k in ['f5_url', 'f5_username', 'f5_password']):
        raise ValueError('Missing credentials')
    data = await f5_request_sys('GET', '/cpu', None, opts)
    return {'content': [{'type': 'text', 'text': f"CPU Stats:\n{json.dumps(data, indent=2)}"}]}

async def run_list_all_virtual(opts):
    if not all(k in opts for k in ['f5_url', 'f5_username', 'f5_password']):
        raise ValueError('Missing credentials')
    data = await f5_request('GET', '/virtual', opts)
    return {'content': [{'type': 'text', 'text': f"All Virtual Servers:\n{json.dumps(data, indent=2)}"}]}

async def run_get_tmm_info(opts):
    data = await f5_request_sys('GET', '/tmm-info', None, opts)
    return {'content': [{'type': 'text', 'text': f"TMM Info:\n{json.dumps(data, indent=2)}"}]}

async def run_get_connection(opts):
    data = await f5_request_sys('GET', '/performance/connections/stats', None, opts)
    return {'content': [{'type': 'text', 'text': f"Connection Info:\n{json.dumps(data, indent=2)}"}]}

async def run_get_certificate_stat(opts):
    data = await f5_request_sys('GET', '/crypto/cert', None, opts)
    return {'content': [{'type': 'text', 'text': f"Certification Info:\n{json.dumps(data, indent=2)}"}]}


# ===== Tools Definitions =====

tools_list = [
    {
        "name": "configurePool",
        "description": "Create a new pool with members",
        "inputSchema": {
            "type": "object",
            "properties": {
                "f5_url": {"type": "string"}, "f5_username": {"type": "string"}, "f5_password": {"type": "string"},
                "pool_name": {"type": "string", "description": "Name of the pool"},
                "members": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "address": {"type": "string"}, "port": {"type": "integer"}
                        },
                        "required": ["address", "port"]
                    }
                }
            },
            "required": ["f5_url", "f5_username", "f5_password", "pool_name", "members"]
        },
        "handler": run_configure_pool
    },
    {
        "name": "listAllPoolStat",
        "description": "List all pool stats",
        "inputSchema": {
             "type": "object",
             "properties": {
                "f5_url": {"type": "string"}, "f5_username": {"type": "string"}, "f5_password": {"type": "string"}
             },
             "required": ["f5_url", "f5_username", "f5_password"]
        },
        "handler": run_list_all_pool_stat
    },
    {
        "name": "removeMember",
        "description": "Remove a member from a pool",
        "inputSchema": {
            "type": "object",
             "properties": {
                "f5_url": {"type": "string"}, "f5_username": {"type": "string"}, "f5_password": {"type": "string"},
                "pool_name": {"type": "string"}, "member_address": {"type": "string"}, "member_port": {"type": "integer"}
             },
             "required": ["f5_url", "f5_username", "f5_password", "pool_name", "member_address", "member_port"]
        },
        "handler": run_remove_member
    },
    {
        "name": "deletePool",
        "description": "Delete an entire pool",
        "inputSchema": {
            "type": "object",
             "properties": {
                "f5_url": {"type": "string"}, "f5_username": {"type": "string"}, "f5_password": {"type": "string"},
                "pool_name": {"type": "string"}
             },
             "required": ["f5_url", "f5_username", "f5_password", "pool_name"]
        },
        "handler": run_delete_pool
    },
    {
        "name": "createVirtualServer",
        "description": "Create a virtual server and bind it to a pool",
        "inputSchema": {
            "type": "object",
             "properties": {
                "f5_url": {"type": "string"}, "f5_username": {"type": "string"}, "f5_password": {"type": "string"},
                "virtual_name": {"type": "string"}, "ip": {"type": "string"}, "port": {"type": "integer"}, "pool_name": {"type": "string"}
             },
             "required": ["f5_url", "f5_username", "f5_password", "virtual_name", "ip", "port"]
        },
        "handler": run_create_virtual_server
    },
    {
        "name": "deleteVirtualServer",
        "description": "Delete a virtual server",
        "inputSchema": {
            "type": "object",
             "properties": {
                "f5_url": {"type": "string"}, "f5_username": {"type": "string"}, "f5_password": {"type": "string"},
                "virtual_name": {"type": "string"}
             },
             "required": ["f5_url", "f5_username", "f5_password", "virtual_name"]
        },
        "handler": run_delete_virtual_server
    },
    {
        "name": "getPoolMemberStatus",
        "description": "Get status of members in a pool",
        "inputSchema": {
             "type": "object",
             "properties": {
                "f5_url": {"type": "string"}, "f5_username": {"type": "string"}, "f5_password": {"type": "string"},
                "pool_name": {"type": "string"}
             },
             "required": ["f5_url", "f5_username", "f5_password", "pool_name"]
        },
        "handler": run_get_pool_member_status
    },
    {
        "name": "getLtmLogs",
        "description": "Retrieve LTM logs within a specified time range",
        "inputSchema": {
            "type": "object",
             "properties": {
                "f5_url": {"type": "string"}, "f5_username": {"type": "string"}, "f5_password": {"type": "string"},
                "start_time": {"type": "string"}, "end_time": {"type": "string"}
             },
             "required": ["f5_url", "f5_username", "f5_password", "start_time", "end_time"]
        },
        "handler": run_get_ltm_logs
    },
    {
        "name": "updateMemberStat",
        "description": "Set a pool member status to enable or disable",
        "inputSchema": {
            "type": "object",
             "properties": {
                "f5_url": {"type": "string"}, "f5_username": {"type": "string"}, "f5_password": {"type": "string"},
                "pool_name": {"type": "string"}, "member_address": {"type": "string"}, "member_port": {"type": "integer"},
                "action": {"type": "string", "enum": ["enable", "disable"]}
             },
             "required": ["f5_url", "f5_username", "f5_password", "pool_name", "member_address", "member_port", "action"]
        },
        "handler": run_update_member_stat
    },
    {
        "name": "addIrules",
        "description": "Upload an iRule to the F5",
        "inputSchema": {
            "type": "object",
             "properties": {
                "f5_url": {"type": "string"}, "f5_username": {"type": "string"}, "f5_password": {"type": "string"},
                "irule_name": {"type": "string"}, "irule_code": {"type": "string"}, "partition": {"type": "string"}
             },
             "required": ["f5_url", "f5_username", "f5_password", "irule_name", "irule_code"]
        },
        "handler": run_add_irules
    },
    {
        "name": "getCpuStat",
        "description": "Get CPU statistics from the F5 device",
        "inputSchema": {
             "type": "object",
             "properties": {
                "f5_url": {"type": "string"}, "f5_username": {"type": "string"}, "f5_password": {"type": "string"}
             },
             "required": ["f5_url", "f5_username", "f5_password"]
        },
        "handler": run_get_cpu_stat
    },
    {
        "name": "listAllVirtual",
        "description": "List all virtual servers",
        "inputSchema": {
             "type": "object",
             "properties": {
                "f5_url": {"type": "string"}, "f5_username": {"type": "string"}, "f5_password": {"type": "string"}
             },
             "required": ["f5_url", "f5_username", "f5_password"]
        },
        "handler": run_list_all_virtual
    },
    {
        "name": "getTmmInfo",
        "description": "Get TMM info",
        "inputSchema": {
             "type": "object",
             "properties": {
                "f5_url": {"type": "string"}, "f5_username": {"type": "string"}, "f5_password": {"type": "string"}
             },
             "required": ["f5_url", "f5_username", "f5_password"]
        },
        "handler": run_get_tmm_info
    },
    {
        "name": "getConnection",
        "description": "Get connection performance",
        "inputSchema": {
             "type": "object",
             "properties": {
                "f5_url": {"type": "string"}, "f5_username": {"type": "string"}, "f5_password": {"type": "string"}
             },
             "required": ["f5_url", "f5_username", "f5_password"]
        },
        "handler": run_get_connection
    },
    {
        "name": "getCertificateStat",
        "description": "Get certificate information",
        "inputSchema": {
             "type": "object",
             "properties": {
                "f5_url": {"type": "string"}, "f5_username": {"type": "string"}, "f5_password": {"type": "string"}
             },
             "required": ["f5_url", "f5_username", "f5_password"]
        },
        "handler": run_get_certificate_stat
    }
]



# ===== API Endpoints =====

@app.middleware("http")
async def log_middleware(request: Request, call_next):
    if ENABLE_CLIENT_LOG:
        body = await request.body()
        # Log the request
        log_request("MCP", request.method, request.url.path, body.decode() if body else None)
    
    response = await call_next(request)
    
    # 1. Consume the response body entirely to log it
    response_body = [chunk async for chunk in response.body_iterator]
    
    # 2. Re-create an ASYNC iterator for the response to use
    async def async_iterator():
        for chunk in response_body:
            yield chunk
            
    # Assign the async iterator back to the response
    response.body_iterator = async_iterator()
    
    if ENABLE_CLIENT_LOG:
        # Decode and log the response body
        try:
            body_content = b"".join(response_body).decode()
        except Exception:
            body_content = "<binary or non-utf8 content>"
            
        log_response("MCP", response.status_code, body_content)
        
    return response

@app.post("/mcp/list-tools")
async def mcp_list_tools():
    # Remove handler from output
    tools_output = []
    for t in tools_list:
        t_copy = t.copy()
        del t_copy['handler']
        tools_output.append(t_copy)
    return {"tools": tools_output}

@app.post("/mcp/invoke")
async def mcp_invoke(request: Request):
    data = await request.json()
    name = data.get("name") or data.get("params", {}).get("name")
    args = data.get("arguments") or data.get("params", {}).get("arguments") or {}
    
    tool = next((t for t in tools_list if t["name"] == name), None)
    if not tool:
        return JSONResponse(status_code=400, content={"error": f"Unknown tool: {name}"})
    
    try:
        result = await tool["handler"](args)
        return result
    except Exception as e:
        logger.error(f"Error invoking {name}: {e}")
        return JSONResponse(status_code=500, content={"content": [{"type": "text", "text": f"error {str(e)}"}]})

@app.post("/")
async def json_rpc_handler(request: Request):
    data = await request.json()
    method = data.get("method")
    params = data.get("params", {})
    jsonrpc_id = data.get("id")
    
    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": jsonrpc_id,
            "result": {
                "protocolVersion": "2024-11-05", # Updated date
                "capabilities": {"listTools": True, "invoke": True, "call": True},
                "serverInfo": {"name": "f5ConfigServer-Python", "version": "1.0.0"}
            }
        }
    
    if method in ["mcp:list-tools", "tools/list"]:
        tools_output = [{k:v for k,v in t.items() if k != 'handler'} for t in tools_list]
        return {"jsonrpc": "2.0", "id": jsonrpc_id, "result": {"tools": tools_output}}
        
    if method in ["tools/invoke", "mcp:invoke", "tools/call", "mcp:call-tool"]:
        name = params.get("name")
        args = params.get("arguments", {})
        
        tool = next((t for t in tools_list if t["name"] == name), None)
        if not tool:
            return {
                "jsonrpc": "2.0", "id": jsonrpc_id,
                "error": {"code": -32601, "message": f"Unknown tool: {name}"}
            }
        
        try:
            result = await tool["handler"](args)
            return {"jsonrpc": "2.0", "id": jsonrpc_id, "result": result}
        except Exception as e:
            return {
                "jsonrpc": "2.0", "id": jsonrpc_id,
                "error": {"code": -32000, "message": str(e)}
            }
            
    if method == "ping":
        return {"jsonrpc": "2.0", "id": jsonrpc_id, "result": {}}

    return {
        "jsonrpc": "2.0", "id": jsonrpc_id,
        "error": {"code": -32601, "message": f"Method not found: {method}"}
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="F5 MCP Server")
    parser.add_argument("--port", type=int, default=3000, help="Port to run server on")
    args = parser.parse_args()
    
    port = args.port
    # Handle PORT env var if set
    if os.environ.get("PORT"):
        port = int(os.environ.get("PORT"))
        
    print(f"OK, MCP Server running on port {port}")
    try:
        uvicorn.run(app, host="0.0.0.0", port=port)
    except Exception as e:
        print(f"Failed to start server: {e}")