import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/server.js", () => ({
  default: vi.fn().mockRejectedValue(new Error("init boom")),
  MCP_PROTOCOL_VERSION: "2025-11-25",
  version: "1.1.7",
}));

describe("createHttpApp", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 500 when stateless initialization fails", async () => {
    const { createHttpApp } = await import("../../src/server/http-app.js");
    const { app } = createHttpApp({ readOnly: true });
    const routeLayer = (app as any)._router.stack.find(
      (layer: any) => layer.route?.path === "/mcp" && layer.route?.methods?.post,
    );

    expect(routeLayer).toBeDefined();
    const handler = routeLayer.route.stack[0].handle as (req: any, res: any) => Promise<void>;

    const res: any = {
      headersSent: false,
      statusCode: 200,
      body: undefined,
      headers: new Map<string, string>(),
      setHeader(name: string, value: string) {
        this.headers.set(name, value);
      },
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        this.headersSent = true;
        return this;
      },
    };

    await handler({ ip: "127.0.0.1" }, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
  });
});
