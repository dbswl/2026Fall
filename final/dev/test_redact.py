# 개인정보 자동 가리기 확인 (실제 시험지 사진은 dev/real/ 에만 두고 저장소에는 올리지 않는다)
import asyncio, sys, base64, glob, os
from playwright.async_api import async_playwright
BASE = 'http://localhost:3999'
FILES = sys.argv[1:] or sorted(glob.glob('dev/real/*.png')) + ['dev/sample_b12.jpg', 'dev/a12_concept.jpg']
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page()
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE + '/app.html'); await pg.add_script_tag(url=BASE + '/assets/redact.js')
        for f in FILES:
            r = await pg.evaluate("""async (src) => {
              const img = new Image(); img.src = src; await img.decode();
              const t = performance.now(); const a = Redact.analyze(img); const ms = performance.now() - t;
              return { rot: a.rot, masks: a.masks.map(m => [m.auto, +m.y.toFixed(3), +m.h.toFixed(3)]), ms: Math.round(ms), out: Redact.render(img, a.rot, a.masks, 900, 0.8) };
            }""", BASE + '/' + f)
            name = os.path.basename(f).split('.')[0]
            open(f'dev/shots/r_{name}.jpg', 'wb').write(base64.b64decode(r['out'].split(',')[1]))
            print(f, 'rot', r['rot'], 'masks', r['masks'], r['ms'], 'ms')
        print('errors', errs); await b.close()
asyncio.run(main())
