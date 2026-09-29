// 받아쓰기 공책 사진에서 글씨를 읽어 주는 중계 서버.
// 구글 Gemini 열쇠는 이 서버 안에만 있고 학생 화면으로는 나가지 않는다.

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const FORMATS = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
// 앞에서부터 쓰고, 그 모델이 붐비거나 늦으면 다음 모델로 넘어간다.
const DEFAULT_MODELS = 'gemini-3.5-flash-lite,gemini-3.5-flash,gemini-3.8-flash';
// 한 모델을 이 시간까지만 기다린다. 다 합쳐도 클라우드플레어가 끊는 시간 안에 들어와야 한다.
const MODEL_TIMEOUT_MS = 20000;
// 붐비거나(503) 잠시 탈이 났거나(500) 그 이름이 사라졌으면(404) 다음 모델로 넘어간다.
const TRY_NEXT = [500, 503, 404];

/* 낱말째로 읽게 두면 AI 가 아는 낱말로 맞춰 버려, 아이가 틀리게 쓴 글자가 바른 글자로
   둔갑한다("정성것"을 "정성껏"으로). 재어 보니 한 글자씩 떼어 읽게 하는 것이 이를 크게
   줄였다. 역할만 못박고 낱말째로 읽게 한 지시문은 소용이 없었다. 띄어쓰기는 채점하지
   않으므로 글자를 떼어 받아도 잃는 것이 없다. */
const PROMPT = `당신은 글자 모양만 읽는 문자 인식기입니다. 한국어 뜻을 이해하지 못하고, 아는 낱말로 짐작하지도 않습니다.

이 사진의 손글씨를 위에서부터 한 줄씩, 한 글자씩 떼어서 사이에 빈칸을 두고 옮겨 적으세요.
예) 학생이 "정성것 치료해"라고 썼으면 -> "정 성 것 치 료 해"

- 글자 하나하나의 모양(자음과 모음, 받침)만 보고 그대로 옮기세요.
- 낱말이 이상해 보여도 그것이 정답입니다. 자연스러운 낱말로 바꾸면 안 됩니다.
- 받침이 'ㅅ'인지 'ㅆ'인지, 첫소리가 된소리인지 예사소리인지 모양을 꼼꼼히 보세요.
- 지우거나 고쳐 쓴 흔적이 있으면 마지막에 남은 글자를 적으세요.
- 줄 앞에 적힌 번호는 빼세요.
- 알아볼 수 없는 줄은 "?" 한 글자만 적으세요.
- 아무것도 쓰지 않은 빈 줄만 건너뛰세요.`;

const SCHEMA = {
  type: 'object',
  properties: { lines: { type: 'array', items: { type: 'string' } } },
  required: ['lines']
};

/* 구글은 홍콩 등 일부 지역에서 오는 요청을 막는다. 클라우드플레어가 한국 접속을
   홍콩 데이터센터로 보내는 일이 있어, 구글 호출만 북미에 고정한 이 방을 거치게 한다. */
export class GeminiCaller {
  async fetch(request) {
    const { url, key, payload, timeout } = await request.json();
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: payload,
        signal: AbortSignal.timeout(timeout)
      });
    } catch {
      return Response.json({ failed: true });
    }
    return Response.json({ status: res.status, body: await res.text() });
  }
}

async function callGemini(env, model, payload) {
  const room = env.CALLER.get(env.CALLER.idFromName('gemini-nam'), { locationHint: 'enam' });
  const res = await room.fetch('https://caller/', {
    method: 'POST',
    body: JSON.stringify({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      key: env.GEMINI_KEY,
      payload,
      timeout: MODEL_TIMEOUT_MS
    })
  });
  return res.json();
}

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

    const models = (env.GEMINI_MODEL || DEFAULT_MODELS).split(',').map(s => s.trim()).filter(Boolean);

    const payload = JSON.stringify({
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
    });

    let answer = null;
    let lateOrBusy = false;
    for (const model of models) {
      const got = await callGemini(env, model, payload);
      if (got.failed) {
        // 시간 안에 답이 없으면 다음 모델로 넘어간다.
        lateOrBusy = true;
        continue;
      }
      console.log(`colo=${request.cf?.colo} model=${model} status=${got.status}`);  // wrangler tail 로 상태를 본다
      answer = got;
      if (got.status === 200 || !TRY_NEXT.includes(got.status)) break;
      lateOrBusy = true;
    }

    if (!answer) {
      return reply({ error: lateOrBusy ? 'AI가 너무 오래 걸려요. 잠시 뒤에 다시 해 보세요.' : 'AI 서버에 연결하지 못했습니다.' }, 502, cors);
    }

    if (answer.status !== 200) {
      if (answer.status === 429) return reply({ error: '오늘 무료로 쓸 수 있는 양을 다 썼어요.' }, 502, cors);
      let why = '';
      try { why = JSON.parse(answer.body)?.error?.message || answer.body.slice(0, 300); }
      catch { why = (answer.body || '').slice(0, 300); }
      return reply({ error: `AI 서버 오류 (${answer.status}) ${why}`.trim() }, 502, cors);
    }

    const out = JSON.parse(answer.body);
    const text = out?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return reply({ error: '사진에서 글씨를 찾지 못했습니다.' }, 200, cors);

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return reply({ error: '읽은 결과를 이해하지 못했습니다.' }, 502, cors);
    }

    // "?" 는 못 읽은 줄이라는 표시로 그대로 넘긴다. 빼 버리면 줄의 차례가 어긋난다.
    const lines = (parsed.lines || [])
      .map(s => String(s).trim())
      .filter(Boolean)
      .map(text => ({ text, confidence: 1 }));

    console.log(`lines=${lines.length}`);  // 몇 줄을 읽었는지만 남긴다. 내용은 남기지 않는다.
    return reply({ lines }, 200, cors);
  }
};
