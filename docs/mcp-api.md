# MCP API (Prototype)

Endpoint:

- `POST /mcp` JSON-RPC
- `GET /mcp` SSE stream (server → client)
- `GET /mcp/discover` returns `{ url, bearer, protocol_version }`

Tools:

- `klaxon.notify`
- `klaxon.ask`
- `klaxon.ack`
- `klaxon.dismiss`

Resources:

- `klaxon/open`
- `klaxon/item/{id}`
- `klaxon/answer/{id}`
