async (page) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto("http://127.0.0.1:4173/src/sidepanel/index.html");
  await page.setContent('<main id="preview-root"></main>');
  const result = await page.evaluate(async () => {
    const actions = [];
    window.__eklaimActions = actions;
    window.chrome = {
      tabs: {
        query: async () => [{ id: 8, url: "http://172.16.0.5/E-Klaim/index.php?0=padm&slpat_ch=y" }],
        update: async () => undefined,
      },
      permissions: { contains: async () => true },
      scripting: {
        executeScript: async ({ args }) => {
          actions.push(args[0]);
          return [{ result: { ok: true, message: "OK" } }];
        },
      },
    };
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { RegroupingStage } = await import("/src/sidepanel/App.tsx");
    createRoot(document.getElementById("preview-root")).render(React.createElement(RegroupingStage, { onBack: () => undefined }));
    return { mounted: true };
  });
  if (!result.mounted) throw new Error("Layar Re-grouping gagal dimuat.");

  const sep = "1709R0090826V000106";
  await page.getByLabel("Nomor SEP").fill(sep);
  await page.getByRole("button", { name: "Re-grouping", exact: true }).click();
  await page.getByText("Terkirim", { exact: true }).waitFor({ timeout: 20_000 });

  const preview = page.getByRole("button", { name: `Periksa SEP ${sep} di e-Klaim` });
  const box = await preview.boundingBox();
  if (!box || box.width < 44 || box.height < 44) throw new Error(`Target tombol preview terlalu kecil: ${JSON.stringify(box)}`);
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (hasHorizontalOverflow) throw new Error("Layar Re-grouping melebar keluar viewport 375 px.");

  await page.evaluate(() => { window.__eklaimActions.length = 0; });
  await preview.click();
  await page.getByText(`SEP ${sep} sudah dibuka. Otomatisasi berhenti; silakan periksa hasilnya secara manual.`, { exact: true }).waitFor();

  const reviewActions = await page.evaluate(() => window.__eklaimActions);
  const expected = ["validate-home", "open-patient", "open-admission", "clear-lock"];
  if (JSON.stringify(reviewActions) !== JSON.stringify(expected)) {
    throw new Error(`Preview menjalankan langkah yang tidak tepat: ${JSON.stringify(reviewActions)}`);
  }
}
