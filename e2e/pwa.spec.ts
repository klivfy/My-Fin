import { expect, test } from "@playwright/test";

/**
 * Smoke tests multiplataforma: validam que o shell renderiza nas 3 engines
 * e nos viewports mobile, e que os artefatos PWA estão acessíveis.
 */

test.describe("PWA", () => {
  test("manifest está acessível e bem formado", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.ok()).toBe(true);
    const manifest = await response.json();
    expect(manifest.name).toContain("My-Fin");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.length).toBeGreaterThanOrEqual(4);
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  });

  test("service worker está disponível", async ({ request }) => {
    const response = await request.get("/sw.js");
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain("myfin-static");
  });

  test("página offline renderiza", async ({ page }) => {
    await page.goto("/offline");
    await expect(page.getByText("Você está offline")).toBeVisible();
  });

  test("login renderiza em qualquer engine", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "My-Fin" })).toBeVisible();
    await expect(page.getByLabel("Token")).toBeVisible();
  });
});
