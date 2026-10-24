// MUFICO - funció de Netlify: guarda i llegeix el fitxer de dades a GitHub.
// El token NO és al codi: es llegeix de les variables de Netlify (GITHUB_TOKEN, GITHUB_REPO).
const API = 'https://api.github.com';

exports.handler = async (event) => {
  const T = process.env.GITHUB_TOKEN;
  const R = process.env.GITHUB_REPO;
  const P = process.env.GITHUB_PATH || 'mufico-data.json';
  const B = process.env.GITHUB_BRANCH || 'data';
  const H = {
    Authorization: 'Bearer ' + T,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'mufico'
  };
  const out = (s, o) => ({
    statusCode: s,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(o || {})
  });
  if (!T || !R) return out(500, { error: 'Falten les variables GITHUB_TOKEN i GITHUB_REPO a Netlify' });

  try {
    // 1) Les dades viuen a la branca "data" (així no es torna a publicar l'app a cada canvi). Es crea sola.
    const ref = await fetch(`${API}/repos/${R}/git/ref/heads/${B}`, { headers: H });
    if (ref.status === 404) {
      const repo = await fetch(`${API}/repos/${R}`, { headers: H });
      if (!repo.ok) return out(502, { error: 'repositori', status: repo.status });
      const def = (await repo.json()).default_branch;
      const base = await fetch(`${API}/repos/${R}/git/ref/heads/${def}`, { headers: H });
      if (!base.ok) return out(502, { error: 'branca principal', status: base.status });
      const sha = (await base.json()).object.sha;
      const mk = await fetch(`${API}/repos/${R}/git/refs`, {
        method: 'POST', headers: H, body: JSON.stringify({ ref: 'refs/heads/' + B, sha })
      });
      if (!mk.ok && mk.status !== 422) return out(502, { error: 'crear branca', status: mk.status });
    } else if (!ref.ok) {
      return out(502, { error: 'github', status: ref.status });
    }

    const url = `${API}/repos/${R}/contents/${P}`;

    // 2) Llegir
    if (event.httpMethod === 'GET') {
      const g = await fetch(`${url}?ref=${B}`, { headers: H });
      if (g.status === 404) return out(404, { missing: true });
      if (!g.ok) return out(502, { error: 'llegir', status: g.status });
      const j = await g.json();
      return out(200, { sha: j.sha, content: j.content });
    }

    // 3) Desar (només si el contingut és un JSON de MUFICO)
    if (event.httpMethod === 'PUT') {
      const b = JSON.parse(event.body || '{}');
      if (typeof b.content !== 'string' || b.content.length > 900000) return out(400, { error: 'contingut' });
      let d;
      try { d = JSON.parse(Buffer.from(b.content, 'base64').toString('utf8')); } catch (e) { return out(400, { error: 'json' }); }
      if (!d || !Array.isArray(d.rooms) || !Array.isArray(d.acts)) return out(400, { error: 'format' });
      const body = { message: 'MUFICO ' + new Date().toISOString(), content: b.content, branch: B };
      if (b.sha) body.sha = b.sha;
      const p = await fetch(url, { method: 'PUT', headers: H, body: JSON.stringify(body) });
      if (p.status === 409 || p.status === 422) return out(409, { conflict: true });
      if (!p.ok) return out(502, { error: 'desar', status: p.status });
      return out(200, { sha: (await p.json()).content.sha });
    }

    return out(405, { error: 'mètode' });
  } catch (e) {
    return out(500, { error: 'funció' });
  }
};
