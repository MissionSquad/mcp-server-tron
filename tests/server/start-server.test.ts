import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/resources.js", () => ({
  registerTRONResources: vi.fn(() => {
    throw new Error("resource boom");
  }),
}));

vi.mock("../../src/core/tools/index.js", () => ({
  registerTRONTools: vi.fn(),
}));

vi.mock("../../src/core/prompts.js", () => ({
  registerTRONPrompts: vi.fn(),
}));

describe("startServer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws on initialization failures without exiting the process", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as any);
    const { default: startServer } = await import("../../src/server/server.js");

    await expect(startServer({ readOnly: true })).rejects.toThrow("resource boom");
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
