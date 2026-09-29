# index.html 의 문장 목록을 읽어 AI 음성 파일(audio/<목소리>/<회차>-<번호>.mp3)을 만든다.
# 문장을 고쳤을 때: python make_audio.py
import asyncio, re, sys
from pathlib import Path

import edge_tts

BASE = Path(__file__).parent
VOICES = {
    "sunhi":  "ko-KR-SunHiNeural",
    "injoon": "ko-KR-InJoonNeural",
    "hyunsu": "ko-KR-HyunsuMultilingualNeural",
}


def load_rounds():
    html = (BASE / "index.html").read_text(encoding="utf-8")
    body = re.search(r"const ROUNDS = \[(.*?)\n\];", html, re.S).group(1)
    rounds = {}
    for block in re.finditer(r"\{n:(\d+),\s*unit:\d+,\s*items:\[(.*?)\]\}", body, re.S):
        n = int(block.group(1))
        rounds[n] = re.findall(r'"(.*?)"', block.group(2))
    return rounds


async def make_one(sem, voice_id, text, out):
    async with sem:
        for attempt in range(3):
            try:
                await edge_tts.Communicate(text, voice_id).save(str(out))
                return True
            except Exception as e:
                if attempt == 2:
                    print(f"  실패 {out.name}: {e}")
                    return False
                await asyncio.sleep(1.5)


async def main():
    rounds = load_rounds()
    total = sum(len(v) for v in rounds.values()) * len(VOICES)
    print(f"문장 {sum(len(v) for v in rounds.values())}개 × 목소리 {len(VOICES)}종 = {total}개 파일")

    sem = asyncio.Semaphore(6)
    tasks = []
    for key, voice_id in VOICES.items():
        folder = BASE / "audio" / key
        folder.mkdir(parents=True, exist_ok=True)
        for n, items in rounds.items():
            for i, text in enumerate(items, 1):
                out = folder / f"{n:02d}-{i:02d}.mp3"
                if out.exists() and out.stat().st_size > 0 and "--force" not in sys.argv:
                    continue
                tasks.append(make_one(sem, voice_id, text, out))

    if not tasks:
        print("이미 다 만들어져 있어요. 다시 만들려면 --force 를 붙이세요.")
        return
    done = await asyncio.gather(*tasks)
    print(f"새로 만든 파일 {sum(1 for d in done if d)}개 / 실패 {sum(1 for d in done if not d)}개")


asyncio.run(main())
