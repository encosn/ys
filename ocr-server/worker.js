// 받아쓰기 공책 사진을 CLOVA OCR 로 넘겨 주는 중계 서버.
// 네이버 열쇠(CLOVA_URL, CLOVA_SECRET)는 이 서버 안에만 있고 학생 화면으로는 나가지 않는다.

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const FORMATS = ['jpg', 'jpeg', 'png'];

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const hit = origin && allowed.includes(origin) ? origin : null;
  return {
    headers: {
      'Access-Control-Allow-Origin': hit || 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    },
    allowed: Boolean(hit)
  };
}

function reply(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors.headers, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

/* CLOVA 는 낱말 상자를 차례로 돌려준다. lineBreak 가 켜진 곳에서 줄을 끊어 문장으로 묶는다. */
function toLines(fields) {
  const lines = [];
  let words = [];
  let scores = [];
  for (const f of fields || []) {
    words.push(f.inferText);
    scores.push(typeof f.inferConfidence === 'number' ? f.inferConfidence : 1);
    if (f.lineBreak) {
      lines.push({
        text: words.join(' ').trim(),
        confidence: scores.reduce((a, b) => a + b, 0) / scores.length
      });
      words = [];
      scores = [];
    }
  }
  if (words.length) {
    lines.push({
      text: words.join(' ').trim(),
      confidence: scores.reduce((a, b) => a + b, 0) / scores.length
    });
  }
  return lines.filter(l => l.text);
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request.headers.get('Origin'), env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors.headers });
    if (request.method !== 'POST') return reply({ error: 'POST 로만 받습니다.' }, 405, cors);
    if (!cors.allowed) return reply({ error: '허락되지 않은 주소에서 온 요청입니다.' }, 403, cors);
    if (!env.CLOVA_URL || !env.CLOVA_SECRET) {
      return reply({ error: '서버에 네이버 OCR 열쇠가 아직 설정되지 않았습니다.' }, 500, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return reply({ error: '요청을 읽을 수 없습니다.' }, 400, cors);
    }

    const format = String(body.format || 'jpg').toLowerCase();
    const data = body.data;
    if (!data || typeof data !== 'string') return reply({ error: '사진이 없습니다.' }, 400, cors);
    if (!FORMATS.includes(format)) return reply({ error: '지원하지 않는 사진 형식입니다.' }, 400, cors);
    if (data.length * 0.75 > MAX_IMAGE_BYTES) return reply({ error: '사진이 너무 큽니다.' }, 413, cors);

    let res;
    try {
      res = await fetch(env.CLOVA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-OCR-SECRET': env.CLOVA_SECRET },
        body: JSON.stringify({
          version: 'V2',
          requestId: crypto.randomUUID(),
          timestamp: Date.now(),
          lang: 'ko',
          images: [{ format, name: 'dictation', data }]
        })
      });
    } catch {
      return reply({ error: '네이버 OCR 에 연결하지 못했습니다.' }, 502, cors);
    }

    if (!res.ok) {
      return reply({ error: `네이버 OCR 오류 (${res.status})` }, 502, cors);
    }

    const out = await res.json();
    const image = out.images && out.images[0];
    if (!image || image.inferResult !== 'SUCCESS') {
      return reply({ error: '사진에서 글씨를 찾지 못했습니다.' }, 200, cors);
    }
    return reply({ lines: toLines(image.fields) }, 200, cors);
  }
};
