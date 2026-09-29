# 사진 채점 중계 서버 준비하기

공책 사진을 네이버 CLOVA OCR로 보내 글씨를 읽어 오는 작은 서버입니다.
네이버 열쇠를 이 서버 안에만 두기 때문에, 공개된 학생 화면에는 열쇠가 나타나지 않습니다.

준비는 크게 세 단계입니다. 한 번만 해 두면 그다음부터는 손댈 일이 없습니다.

## 1단계. 네이버에서 OCR 열쇠 받기

1. [네이버 클라우드 플랫폼](https://www.ncloud.com)에 가입하고 결제 수단을 등록합니다.
2. 콘솔에서 **Services → AI Services → CLOVA OCR**로 들어갑니다.
3. **Domain 생성**을 누르고, 인식 모델은 **General**, 언어는 **한국어**로 만듭니다.
4. 만든 도메인의 **APIGW Invoke URL**과 **Secret Key**를 적어 둡니다.
   - Invoke URL은 `https://...apigw.ntruss.com/custom/v1/00000/xxxxx/general` 모양입니다.
   - Secret Key는 아무에게도 알려 주면 안 되는 비밀번호입니다.

요금은 글씨를 읽을 때마다 건당으로 붙습니다. 한 반 분량은 큰 금액이 아니지만,
콘솔의 **요금 → 이용 한도 설정**에서 한 달 상한을 걸어 두면 마음이 놓입니다.

## 2단계. 중계 서버 올리기

[클라우드플레어](https://dash.cloudflare.com/sign-up)에 무료로 가입한 뒤, 이 폴더에서 차례대로 실행합니다.

```bash
npx wrangler login
npx wrangler secret put CLOVA_URL
npx wrangler secret put CLOVA_SECRET
npx wrangler deploy
```

- `secret put`을 하면 값을 입력하라고 물어봅니다. 1단계에서 적어 둔 Invoke URL과 Secret Key를 각각 붙여 넣습니다.
- 입력한 값은 클라우드플레어 안에만 저장되고, 이 폴더의 파일에는 남지 않습니다.
- 마지막 `deploy`가 끝나면 `https://ys-ocr.○○○.workers.dev` 같은 주소를 알려 줍니다.

## 3단계. 앱에 주소 알려 주기

`index.html`에서 아래 줄을 찾아 2단계에서 받은 주소를 적습니다.

```js
let OCR_SERVER = '';
```

주소를 적고 깃허브에 올리면, 받아쓰기를 마친 정답 화면에 **📷 공책 사진으로 채점하기** 단추가 나타납니다.
주소가 비어 있는 동안에는 단추가 숨겨지고, 지금처럼 손으로 채점하는 방식 그대로 쓸 수 있습니다.

## 알아 둘 점

- **사진은 어디에도 저장되지 않습니다.** 글씨를 읽는 동안만 쓰이고 바로 사라집니다. 그래도 이름이나 얼굴은 찍히지 않게 하는 편이 좋습니다.
- **AI가 글씨를 잘못 읽을 수 있습니다.** 그래서 읽은 내용을 문장마다 보여 주고, ⭕❌를 눌러 바로잡을 수 있게 해 두었습니다. 마지막 판단은 사람이 합니다.
- **`wrangler.toml`의 `ALLOWED_ORIGINS`에 적힌 주소에서 온 요청만 받습니다.** 사이트 주소가 바뀌면 이 값을 고치고 다시 `deploy` 하세요.
