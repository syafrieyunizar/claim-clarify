async (page) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto("http://127.0.0.1:4173/tests/fixtures/cost-correction-preview.html");
  await page.evaluate(async () => {
    window.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ mappings: [
        { lineId: 1, category: "room", reason: "Kamar rawat" },
        { lineId: 2, category: "nursing", reason: "Asuhan keperawatan" },
        { lineId: 3, category: "consultation", reason: "Konsultasi dokter" },
        { lineId: 4, category: "laboratory", reason: "Pemeriksaan laboratorium" },
        { lineId: 5, category: "drug", reason: "Obat" },
        { lineId: 6, category: "radiology", reason: "Pemeriksaan radiologi" },
        { lineId: 7, category: "nursing", reason: "Tindakan keperawatan" },
      ] }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
    window.chrome = {
      tabs: { query: async () => [{ id: 8, url: "http://172.16.0.5/E-Klaim/index.php?rand=abc" }] },
      permissions: { contains: async () => true },
      scripting: { executeScript: async () => [{ result: { ok: true, message: "OK", sep: "1709R0091026V001757" } }] },
      storage: { local: { get: async () => ({}), set: async () => undefined } },
    };
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { CostCorrectionStage } = await import("/src/sidepanel/App.tsx");
    createRoot(document.getElementById("preview-root")).render(React.createElement(CostCorrectionStage, {
      aiConfig: { source: "personal", provider: "openai-compatible", endpoint: "https://example.test/v1/chat/completions", model: "test", apiKey: "test" },
      onBack: () => undefined,
      onAuditAdded: () => undefined,
    }));
  });

  const sample = `No Deskripsi Layanan Total
1 Kamar/Akomodasi Rp. 2,000,000
2 Keperawatan Rp. 600,000
3 konsultasi Rp. 370,000
4 Laboratorium Rp. 359,000
5 Obat Rp. 966,227
6 Radiologi Rp. 515,000
7 Tindakan Keperawatan & Konsultasi IGD Rp. 666,700
Semua Total Biaya Pelayanan : Rp. 5,476,927`;
  await page.getByLabel("Rincian biaya pelayanan").fill(sample);
  await page.getByRole("button", { name: "Petakan Biaya dengan AI" }).click();
  await page.getByText("Preview pemetaan", { exact: true }).waitFor();
  const nursingRow = page.getByText("Keperawatan", { exact: true }).locator("..");
  if (!(await nursingRow.innerText()).includes("Rp1.266.700")) throw new Error("Biaya Keperawatan tidak dijumlahkan dengan benar.");
  if (!(await page.getByText("Rp5.476.927", { exact: true }).isVisible())) throw new Error("Total preview tidak tampil.");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflow) throw new Error("Layar Perbaikan Biaya melebar keluar viewport 375 px.");
  await page.screenshot({ path: "output/playwright/cost-correction-preview.png", fullPage: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 700, height: 375 });
  const landscapeOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (landscapeOverflow) throw new Error("Layar Perbaikan Biaya melebar pada orientasi landscape.");
  await page.setViewportSize({ width: 375, height: 700 });

  await page.getByRole("button", { name: "Terapkan ke e-Klaim" }).click();
  await page.getByText("Terapkan biaya ke e-Klaim?", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Terapkan Biaya", exact: true }).click();
  await page.getByText(/sudah diisikan pada 1709R0091026V001757/).waitFor();

  const injected = await page.evaluate(async () => {
    document.body.innerHTML = '<input id="no_sep" value="1709R0091026V001757"><input type="hidden" id="billing_amount"><div id="tdbilling_amount"></div><button id="edit">Edit Ulang Klaim</button><main id="fields"></main>';
    const { EKLAIM_COST_FIELDS, executeEklaimCostStep } = await import("/src/lib/eklaim/costCorrection.ts");
    const fields = document.getElementById("fields");
    for (const field of EKLAIM_COST_FIELDS) fields.insertAdjacentHTML("beforeend", `<input id="${field.inputId}" disabled value="0">`);
    document.getElementById("edit").addEventListener("click", () => document.querySelectorAll('#fields input').forEach((input) => { input.disabled = false; }));
    const values = EKLAIM_COST_FIELDS.map((field) => ({ inputId: field.inputId, amount: field.key === "nursing" ? 1266700 : 0 }));
    const opening = await executeEklaimCostStep("prepare", values, 1266700);
    const ready = await executeEklaimCostStep("prepare", values, 1266700);
    const applied = await executeEklaimCostStep("apply", values, 1266700);
    return {
      opening,
      ready,
      applied,
      nursing: document.getElementById("nursing_amt").value,
      total: document.getElementById("billing_amount").value,
    };
  });
  if (injected.opening.ok || !injected.opening.retry || !injected.ready.ok || !injected.applied.ok || injected.nursing !== "1266700" || injected.total !== "1266700") {
    throw new Error(`Simulasi pengisian kolom e-Klaim gagal: ${JSON.stringify(injected)}`);
  }
  console.log(JSON.stringify(injected, null, 2));
}
