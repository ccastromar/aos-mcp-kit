// What the Tribunal does at once when an attack gets through. Containment only ever closes:
// it suspends, it alerts. The repair is proposed to a person and applied by one.

export interface ContainmentResult {
  action: string;
  done: boolean;
  detail: string;
}

export interface PrudenceAccess {
  url: string;
  tokenUrl: string;
  clientId: string;
  user: string;
  password: string;
}

async function personToken(p: PrudenceAccess): Promise<string> {
  const res = await fetch(p.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", client_id: p.clientId, username: p.user, password: p.password })
  });
  if (!res.ok) throw new Error(`token for ${p.user}: HTTP ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Opens an incident that suspends the AI system in Prudence: from then on every run is DENY. */
export async function suspendAiSystem(p: PrudenceAccess | undefined, aiSystemId: string | undefined, attackId: string, observed: string): Promise<ContainmentResult> {
  const action = `suspend AI system ${aiSystemId ?? "(unknown)"} in Prudence`;
  if (!p || !aiSystemId) return { action, done: false, detail: "Prudence access or system id not configured: alert only" };
  try {
    const now = new Date().toISOString();
    const res = await fetch(`${p.url}/api/incidents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await personToken(p)}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        aiSystemId,
        title: `Tribunal: governance breach (${attackId})`,
        description: `The governance Tribunal got through: ${observed}. Suspended automatically until a person reviews it.`,
        occurredAt: now,
        detectedAt: now,
        memberStates: ["ES"],
        category: "NOT_SERIOUS",
        widespreadInfringement: false,
        causalLink: "SUSPECTED",
        suspendSystem: true
      })
    });
    return { action, done: res.ok, detail: res.ok ? "incident opened, system suspended" : `Prudence answered HTTP ${res.status}` };
  } catch (e) {
    return { action, done: false, detail: (e as Error).message };
  }
}

export function alert(attackId: string, observed: string): ContainmentResult {
  return { action: "alert", done: true, detail: `${attackId}: ${observed}` };
}
