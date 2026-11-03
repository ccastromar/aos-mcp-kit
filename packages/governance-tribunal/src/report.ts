import type { ContainmentResult } from "./containment.js";
import type { Verdict } from "./attacks.js";

export interface AttackRecord {
  id: string;
  title: string;
  guarantee: string;
  expect: string;
  rings: string[];
  verdict: Verdict;
  observed: string;
  proof: Record<string, unknown>;
  containment?: ContainmentResult;
  startedAt: string;
  durationMs: number;
}

export interface Report {
  tribunal: "governance-tribunal/v1";
  ring: string;
  target: { aos: string; ernest?: string; prudence?: string };
  startedAt: string;
  finishedAt: string;
  summary: Record<Verdict, number>;
  attacks: AttackRecord[];
}

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const LABEL: Record<Verdict, string> = { held: "Contenido", breach: "Brecha", error: "Error", planned: "Pendiente" };

export function renderHtml(r: Report): string {
  const order: Verdict[] = ["breach", "error", "held", "planned"];
  const attacks = [...r.attacks].sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict));
  const cards = attacks
    .map(
      (a) => `
    <article class="card ${a.verdict}">
      <header>
        <span class="badge ${a.verdict}">${LABEL[a.verdict]}</span>
        <h2>${esc(a.title)}</h2>
        <code class="id">${esc(a.id)}</code>
      </header>
      <dl>
        <dt>Garantía</dt><dd>${esc(a.guarantee)}</dd>
        <dt>Esperado</dt><dd>${esc(a.expect)}</dd>
        <dt>Observado</dt><dd>${esc(a.observed)}</dd>
        ${a.containment ? `<dt>Contención</dt><dd>${esc(a.containment.action)}: ${esc(a.containment.detail)}</dd>` : ""}
        <dt>Anillos</dt><dd>${a.rings.map(esc).join(", ")} · ${a.durationMs} ms</dd>
      </dl>
      ${Object.keys(a.proof).length ? `<details><summary>Pruebas</summary><pre>${esc(JSON.stringify(a.proof, null, 2))}</pre></details>` : ""}
    </article>`
    )
    .join("");
  const s = r.summary;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Expediente del Tribunal</title>
<style>
:root{--bg:#f6f5f2;--fg:#1d1c1a;--muted:#6b675f;--card:#fff;--line:#e3e0d9;--held:#1f7a4d;--breach:#b42318;--error:#b26b00;--planned:#5b6472}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ecebe7;--muted:#a19d94;--card:#1e1d1b;--line:#33312d;--held:#4cc38a;--breach:#f97066;--error:#fdb022;--planned:#98a2b3}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:920px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:26px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 24px}
.tally{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:24px}
.tally div{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}
.tally b{display:block;font-size:24px}.tally .breach b{color:var(--breach)}.tally .held b{color:var(--held)}.tally .error b{color:var(--error)}.tally .planned b{color:var(--planned)}
.card{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--planned);border-radius:10px;padding:16px;margin-bottom:12px}
.card.held{border-left-color:var(--held)}.card.breach{border-left-color:var(--breach)}.card.error{border-left-color:var(--error)}
.card header{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.card h2{font-size:16px;margin:0;flex:1 1 300px}
.badge{font-size:12px;font-weight:600;padding:2px 8px;border-radius:99px;color:#fff;background:var(--planned)}
.badge.held{background:var(--held)}.badge.breach{background:var(--breach)}.badge.error{background:var(--error)}
.id{color:var(--muted);font-size:12px}
dl{display:grid;grid-template-columns:110px minmax(0,1fr);gap:4px 12px;margin:12px 0 0}dt{color:var(--muted)}dd{margin:0}
details{margin-top:10px}pre{overflow:auto;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px;font-size:12px}
@media (max-width:560px){.tally{grid-template-columns:repeat(2,minmax(0,1fr))}dl{grid-template-columns:1fr}}
</style>
</head>
<body><main>
<h1>Expediente del Tribunal de Gobernanza</h1>
<p class="sub">Anillo <b>${esc(r.ring)}</b> · ${esc(r.startedAt)} → ${esc(r.finishedAt)} · AOS ${esc(r.target.aos)}${r.target.ernest ? ` · Ernest ${esc(r.target.ernest)}` : ""}</p>
<section class="tally">
  <div class="breach"><b>${s.breach}</b>brechas</div>
  <div class="held"><b>${s.held}</b>contenidos</div>
  <div class="error"><b>${s.error}</b>errores</div>
  <div class="planned"><b>${s.planned}</b>pendientes</div>
</section>
${cards}
</main></body></html>
`;
}
