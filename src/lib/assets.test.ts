import { describe, expect, it } from "vitest";
import { assetFilterOf, formatBytes, refMatchesAsset, resolveAssetRef } from "./assets";

describe("refMatchesAsset", () => {
  it("matches the exact path", () => {
    expect(refMatchesAsset("figures/plot.pdf", "figures/plot.pdf")).toBe(true);
  });

  it("matches the extension-less stem (LaTeX resolves it)", () => {
    expect(refMatchesAsset("figures/plot", "figures/plot.png")).toBe(true);
  });

  it("does not match other files", () => {
    expect(refMatchesAsset("figures/plot", "figures/other.png")).toBe(false);
  });
});

describe("assetFilterOf", () => {
  it("categorizes by extension", () => {
    expect(assetFilterOf("figures/plot.png")).toBe("image");
    expect(assetFilterOf("papers/preprint.pdf")).toBe("pdf");
    expect(assetFilterOf("data/results.csv")).toBe("data");
    expect(assetFilterOf("template.sty")).toBe("other");
  });
});

describe("resolveAssetRef", () => {
  const candidates = ["figures/plot.pdf", "figures/photo.png", "assets/data.csv"];

  it("resolves exact and extension-less references", () => {
    expect(resolveAssetRef("figures/plot.pdf", candidates)).toBe("figures/plot.pdf");
    expect(resolveAssetRef("figures/photo", candidates)).toBe("figures/photo.png");
  });

  it("returns null for unknown references", () => {
    expect(resolveAssetRef("figures/missing", candidates)).toBeNull();
    expect(resolveAssetRef("", candidates)).toBeNull();
  });
});

describe("formatBytes", () => {
  it("formats bytes, KB, and MB", () => {
    expect(formatBytes(42)).toBe("42 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
    expect(formatBytes(null)).toBe("");
  });
});
