import { afterEach, describe, expect, it, vi } from "vitest";
import { request, SESSION_EXPIRED_EVENT } from "../../lib/waypoint/api";

afterEach(() => vi.unstubAllGlobals());

describe("Waypoint private client API", () => {
  it("routes account requests through the same-origin protected proxy", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ total: 20 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(request("/api/dashboard")).resolves.toEqual({ total: 20 });
    expect(fetchMock).toHaveBeenCalledWith("/api/waypoint/dashboard", expect.objectContaining({ credentials: "same-origin", cache: "no-store" }));
  });

  it("announces expired sessions so the auth gate clears the mounted portfolio", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    await expect(request("/api/dashboard")).rejects.toThrow("Your session has ended");
    expect(dispatchEvent).toHaveBeenCalledOnce();
    expect(dispatchEvent.mock.calls[0][0].type).toBe(SESSION_EXPIRED_EVENT);
  });

  it("preserves safe server explanations without inventing account data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "The data service is being configured." }), { status: 503 })));
    await expect(request("/api/dashboard")).rejects.toThrow("The data service is being configured.");
  });
});
