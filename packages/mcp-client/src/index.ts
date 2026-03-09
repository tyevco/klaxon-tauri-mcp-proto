/**
 * Tiny typed helper for calling the local MCP server.
 * (Useful for scripts/tests; agents will call MCP directly.)
 */
export type JsonRpcRequest = { jsonrpc: "2.0"; id?: string | number; method: string; params?: any };
export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number;
  result?: any;
  error?: { code: number; message: string; data?: any };
};

export async function mcpCall(
  url: string,
  bearer: string,
  req: JsonRpcRequest | JsonRpcRequest[]
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bearer}`,
      accept: "application/json",
    },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}`);
  // notifications can return empty body
  const txt = await res.text();
  if (!txt) return null;
  return JSON.parse(txt);
}
