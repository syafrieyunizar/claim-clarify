async (page) => {
  await page.goto("http://127.0.0.1:4173/src/sidepanel/index.html");
  await page.setContent('<a href="#wrong" id="nav-grouping">Coding / Grouping</a><main id="claim"></main>');
  const result = await page.evaluate(async () => {
    const claim = document.getElementById("claim");
    const groupingTable = (time, status = "normal") => `<table><caption>Hasil Grouping INACBG</caption><tr><td>Info</td><td id="grouping-info">Dokter @ ${time}</td></tr><tr><td>Status</td><td>${status}</td></tr></table>`;
    claim.innerHTML = `${groupingTable("26 Jun 2026 09:54", "final")}<button id="edit-claim">Edit Ulang Klaim</button>`;
    document.body.dataset.groupingStage = "idrg";
    claim.addEventListener("click", (event) => {
      if (event.target.id === "edit-claim") claim.innerHTML = '<button id="confirm-edit">Ya (edit ulang)</button><button>Tidak (batal edit)</button>';
      if (event.target.id === "confirm-edit") claim.innerHTML = `${groupingTable("26 Jun 2026 09:54", "final")}<input type="button" id="edit-idrg" value="Edit Ulang iDRG">`;
      if (event.target.id === "edit-idrg") claim.innerHTML = `${groupingTable("26 Jun 2026 09:54")}<button id="grouping" onclick="window.__groupingStage='idrg'">Grouping</button>`;
      if (event.target.id === "grouping" && document.body.dataset.groupingStage === "idrg") {
        setTimeout(() => { claim.innerHTML = `${groupingTable("26 Jun 2026 09:54")}<input type="button" id="final-idrg" value="Final iDRG">`; }, 100);
      }
      if (event.target.id === "final-idrg") {
        document.body.dataset.groupingStage = "transition";
        claim.innerHTML = `${groupingTable("26 Jun 2026 09:54")}<input type="button" id="final-idrg" value="Final iDRG"><button id="grouping" onclick="window.__groupingStage='idrg'">Grouping</button>`;
        setTimeout(() => {
          document.body.dataset.groupingStage = "inacbg";
          claim.innerHTML = `${groupingTable("26 Jun 2026 09:54")}<input type="button" id="final-idrg" value="Final iDRG"><button id="grouping" onclick="window.__groupingStage='inacbg'">Grouping</button>`;
        }, 100);
      }
      if (event.target.id === "grouping" && document.body.dataset.groupingStage === "inacbg") {
        setTimeout(() => {
          claim.innerHTML = `${groupingTable("20 Agu 2026 10:30")}<button id="final-inacbg" onclick="window.__final_cbg='inacbg'">Final</button>`;
        }, 100);
      }
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
    steps.push(await executeEklaimRegroupingStep("edit-idrg", ""));
    steps.push(await executeEklaimRegroupingStep("grouping-idrg", ""));
    const earlyIdrg = await executeEklaimRegroupingStep("wait-final-idrg", "");
    await new Promise((resolve) => setTimeout(resolve, 150));
    steps.push(await executeEklaimRegroupingStep("wait-final-idrg", ""));
    steps.push(await executeEklaimRegroupingStep("final-idrg", ""));
    const staleIdrgGroupingBlocked = await executeEklaimRegroupingStep("wait-inacbg-grouping", "");
    await new Promise((resolve) => setTimeout(resolve, 150));
    steps.push(await executeEklaimRegroupingStep("wait-inacbg-grouping", ""));
    steps.push(await executeEklaimRegroupingStep("grouping-inacbg", ""));
    const earlyInacbg = await executeEklaimRegroupingStep("wait-final-inacbg", "");
    await new Promise((resolve) => setTimeout(resolve, 150));
    steps.push(await executeEklaimRegroupingStep("wait-final-inacbg", ""));
    steps.push(await executeEklaimRegroupingStep("final-inacbg", ""));
    steps.push(await executeEklaimRegroupingStep("final-claim", ""));
    steps.push(await executeEklaimRegroupingStep("send-online", ""));
    await new Promise((resolve) => setTimeout(resolve, 150));
    steps.push(await executeEklaimRegroupingStep("wait-sent", ""));
    steps.push(await executeEklaimRegroupingStep("clear-lock", ""));
    return {
      steps,
      earlyIdrgBlocked: !earlyIdrg.ok && earlyIdrg.retry === true,
      staleIdrgGroupingBlocked: !staleIdrgGroupingBlocked.ok && staleIdrgGroupingBlocked.retry === true,
      earlyInacbgBlocked: !earlyInacbg.ok && earlyInacbg.retry === true,
      navigationWasNotClicked: location.hash === "",
      sendClickCount: Number(document.body.dataset.sendClicks || 0),
      finalStatus: document.getElementById("send-status")?.textContent,
      pageUnlocked: !document.getElementById("claim-clarify-regrouping-lock"),
    };
  });

  if (!result.steps.every((step) => step.ok) || !result.earlyIdrgBlocked || !result.staleIdrgGroupingBlocked || !result.earlyInacbgBlocked || !result.navigationWasNotClicked || result.sendClickCount !== 1 || result.finalStatus !== "Terkirim" || !result.pageUnlocked) {
    throw new Error(`Simulasi Re-grouping gagal: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(result, null, 2));
}
