// 받아쓰기 공책 사진에서 글씨를 읽어 주는 중계 서버.
// 구글 Gemini 열쇠는 이 서버 안에만 있고 학생 화면으로는 나가지 않는다.

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const FORMATS = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
const DEFAULT_MODEL = 'gemini-3.5-flash';

// 아이가 틀리게 쓴 글자를 AI가 알아서 고쳐 버리면 채점이 뜻을 잃는다.
// 그래서 '보이는 그대로' 옮기라는 점을 거듭 못박는다.
const PROMPT = `이 사진은 초등학교 3학년 학생이 공책에 쓴 받아쓰기입니다.
위에서부터 한 줄씩, 학생이 쓴 글자를 보이는 그대로 옮겨 적으세요.

지켜야 할 것:
- 맞춤법이 틀린 글자도 틀린 그대로 옮겨 적으세요. 절대 고치지 마세요.
- 띄어 쓴 곳은 띄어 쓴 대로, 붙여 쓴 곳은 붙여 쓴 대로 적으세요.
- 줄 앞에 적힌 번호(1. 2. 등)는 빼고 적으세요.
- 지우거나 고쳐 쓴 흔적이 있으면 마지막에 남은 글자를 적으세요.
- 글자를 알아볼 수 없는 줄은 "?" 한 글자만 적으세요.
- 빈 줄은 건너뛰고, 글씨가 있는 줄만 차례대로 적으세요.`;

const SCHEMA = {
  type: 'object',
  properties: { lines: { type: 'array', items: { type: 'string' } } },
  required: ['lines']
};

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

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request.headers.get('Origin'), env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors.headers });
    if (request.method !== 'POST') return reply({ error: 'POST 로만 받습니다.' }, 405, cors);
    if (!cors.allowed) return reply({ error: '허락되지 않은 주소에서 온 요청입니다.' }, 403, cors);
    if (!env.GEMINI_KEY) return reply({ error: '서버에 열쇠가 아직 설정되지 않았습니다.' }, 500, cors);

    let body;
    try {
      body = await request.json();
    } catch {
      return reply({ error: '요청을 읽을 수 없습니다.' }, 400, cors);
    }

    const format = String(body.format || 'jpg').toLowerCase();
    const data = body.data;
    if (!data || typeof data !== 'string') return reply({ error: '사진이 없습니다.' }, 400, cors);
    if (!FORMATS[format]) return reply({ error: '지원하지 않는 사진 형식입니다.' }, 400, cors);
    if (data.length * 0.75 > MAX_IMAGE_BYTES) return reply({ error: '사진이 너무 큽니다.' }, 413, cors);

    const model = env.GEMINI_MODEL || DEFAULT_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: PROMPT },
              { inline_data: { mime_type: FORMATS[format], data } }
            ]
          }],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: SCHEMA
          }
        })
      });
    } catch {
      return reply({ error: 'AI 서버에 연결하지 못했습니다.' }, 502, cors);
    }

    if (!res.ok) {
      const detail = res.status === 429 ? '오늘 무료로 쓸 수 있는 양을 다 썼어요.' : `AI 서버 오류 (${res.status})`;
      return reply({ error: detail }, 502, cors);
    }

    const out = await res.json();
    const text = out?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return reply({ error: '사진에서 글씨를 찾지 못했습니다.' }, 200, cors);

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return reply({ error: '읽은 결과를 이해하지 못했습니다.' }, 502, cors);
    }

    const lines = (parsed.lines || [])
      .map(s => String(s).trim())
      .filter(s => s && s !== '?')
      .map(text => ({ text, confidence: 1 }));

    return reply({ lines }, 200, cors);
  }
};
