import { projects, loadProject, encodeWav, download } from "../../src/audio";
import { renderDryStem } from "../../src/exports";
const select = document.querySelector<HTMLSelectElement>("#project")!,
  status = document.querySelector("#status")!;
const saved = await projects();
for (const p of saved) {
  const o = document.createElement("option");
  o.value = p.id;
  o.textContent = `${p.name} · ${p.tracks.length} tracks`;
  select.append(o);
}
status.textContent = saved.length
  ? "Choose the authorized project, then export each stem."
  : "No saved projects in this browser/origin.";
for (const kind of ["vocal", "backing"] as const) {
  document.querySelector<HTMLButtonElement>("#" + kind)!.onclick = async () => {
    const buttons = document.querySelectorAll<HTMLButtonElement>("button");
    buttons.forEach((b) => (b.disabled = true));
    try {
      status.textContent = "Rendering locally…";
      const project = await loadProject(
        saved.find((p) => p.id === select.value),
      );
      const stem = await renderDryStem(project.tracks, kind);
      download(encodeWav(stem), `vocalroom-experiment-${kind}.wav`);
      status.textContent = `Exported ${kind}: ${stem.duration.toFixed(3)} seconds. Original project untouched.`;
    } catch (e) {
      status.textContent = e instanceof Error ? e.message : String(e);
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  };
}
