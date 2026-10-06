async (page) => {
  await page.goto("http://127.0.0.1:4173/src/sidepanel/index.html");
  await page.setContent('<a href="#wrong" id="nav-grouping">Coding / Grouping</a><main id="claim"></main>');
  const result = await page.evaluate(async () => {
    const claim = document.getElementById("claim");
    const groupingTable = (time, status = "normal") => `<table><caption>Hasil Grouping INACBG</caption><tr><td>Info</td><td id="grouping-info">Dokter @ ${time}</td></tr><tr><td>Status</td><td>${status}</td></tr></table>`;
    claim.innerHTML = `${groupingTable("26 Jun 2026 09:54", "final")}<button id="edit-claim">Edit Ulang Klaim</button>`;
    claim.addEventListener("click", (event) => {
      if (event.target.id === "edit-claim") claim.innerHTML = '<button id="confirm-edit">Ya (edit ulang)</button><button>Tidak (batal edit)</button>';
      if (event.target.id === "confirm-edit") claim.innerHTML = `${groupingTable("26 Jun 2026 09:54", "final")}<button id="edit-inacbg">Edit Ulang INACBG</button><button>Final Klaim</button>`;
      if (event.target.id === "edit-inacbg") claim.innerHTML = `${groupingTable("26 Jun 2026 09:54")}<button id="grouping">Grouping</button><button id="final-inacbg">Final INACBG</button>`;
      if (event.target.id === "grouping") setTimeout(() => { document.getElementById("grouping-info").textContent = "Dokter @ 20 Agu 2026 10:30"; }, 100);
      if (event.target.id === "final-inacbg") claim.innerHTML = `${groupingTable("20 Agu 2026 10:30", "final")}<button id="final-claim">Final Klaim</button>`;
      if (event.target.id === "final-claim") claim.innerHTML = `${groupingTable("20 Agu 2026 10:30", "final")}<p id="send-status">Terkirim</p><button id="send-online">Kirim Klaim Online</button>`;
      if (event.target.id === "send-online") {
        document.body.dataset.sendClicks = String(Number(document.body.dataset.sendClicks || 0) + 1);
        document.getElementById("send-status").textContent = "Mengirim...";
        setTimeout(() => { document.getElementById("send-status").textContent = "Terkirim"; }, 100);
      }
    });
    const { executeEklaimRegroupingStep } = await import("/src/lib/eklaim/regrouping.ts");
    const steps = [];
    steps.push(await executeEklaimRegroupingStep("edit-claim", ""));
    steps.push(await executeEklaimRegroupingStep("confirm-edit", ""));
    steps.push(await executeEklaimRegroupingStep("edit-inacbg", ""));
    const before = await executeEklaimRegroupingStep("read-grouping-marker", "");
    steps.push(before);
    steps.push(await executeEklaimRegroupingStep("grouping", ""));
    const early = await executeEklaimRegroupingStep("wait-grouping-change", "", before.marker);
    await new Promise((resolve) => setTimeout(resolve, 150));
    steps.push(await executeEklaimRegroupingStep("wait-grouping-change", "", before.marker));
    steps.push(await executeEklaimRegroupingStep("final-inacbg", ""));
    steps.push(await executeEklaimRegroupingStep("final-claim", ""));
    steps.push(await executeEklaimRegroupingStep("send-online", ""));
    await new Promise((resolve) => setTimeout(resolve, 150));
    steps.push(await executeEklaimRegroupingStep("wait-sent", ""));
    return {
      steps,
      earlyWaitBlocked: !early.ok && early.retry === true,
      navigationWasNotClicked: location.hash === "",
      sendClickCount: Number(document.body.dataset.sendClicks || 0),
      finalStatus: document.getElementById("send-status")?.textContent,
    };
  });

  if (!result.steps.every((step) => step.ok) || !result.earlyWaitBlocked || !result.navigationWasNotClicked || result.sendClickCount !== 1 || result.finalStatus !== "Terkirim") {
    throw new Error(`Simulasi Re-grouping gagal: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(result, null, 2));
}
