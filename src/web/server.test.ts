import { afterEach, describe, expect, it, vi } from "vitest";
import { request, ServerError } from "@/web/server";

afterEach(() => {
  vi.unstubAllGlobals();
});

function answer(response: Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response),
  );
}

describe("request", () => {
  it("reads the API's JSON", async () => {
    answer(Response.json({ projects: [] }));
    await expect(request("/api/projects")).resolves.toEqual({ projects: [] });
  });

  it("refuses a web page in place of the API's answer", async () => {
    answer(
      new Response("<!doctype html><title>Polemic</title>", {
        headers: { "content-type": "text/html" },
      }),
    );
    const error = await request("/api/projects").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServerError);
    expect((error as ServerError).code).toBe("unreadable");
    expect((error as ServerError).message).not.toMatch(/JSON/);
  });

  it("refuses JSON it can't parse", async () => {
    answer(new Response("{", { headers: { "content-type": "application/json" } }));
    await expect(request("/api/projects")).rejects.toMatchObject({
      code: "unreadable",
    });
  });
});
