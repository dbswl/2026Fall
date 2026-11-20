# 데모 모드 흐름 확인: 사진 올리기 → 진단 → 줄/원인 수정 → 반영 → 각 탭
import asyncio, sys
from playwright.async_api import async_playwright
BASE = 'http://localhost:3999'
async def fonts(route):
    if 'fonts.googleapis.com' in route.request.url:
        await route.fulfill(status=302, headers={'location': BASE + '/dev/fonts/index.css'})
    else:
        await route.abort()
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': 1280, 'height': 900})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('console:' + m.text) if m.type == 'error' else None)
        await pg.route('https://fonts.googleapis.com/**', fonts)
        await pg.route('https://fonts.gstatic.com/**', lambda r: r.abort())
        await pg.goto(BASE + '/app.html'); await pg.wait_for_timeout(800)
        await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_timeout(800)
        await pg.screenshot(path='dev/shots/1_empty.png', full_page=True)
        await pg.select_option('#qsel', '12'); await pg.select_option('#ssel', 'B')
        await pg.set_input_files('#file', 'dev/sample_b12.jpg'); await pg.wait_for_timeout(500)
        await pg.screenshot(path='dev/shots/2_photo.png', full_page=True)
        await pg.click('#go'); await pg.wait_for_timeout(700)
        await pg.screenshot(path='dev/shots/3_loading.png')
        await pg.wait_for_selector('[data-act=confirm]', timeout=15000)
        await pg.screenshot(path='dev/shots/4_result.png', full_page=True)
        await pg.click('[data-act=pick]'); await pg.click('[data-line="2"]')
        await pg.select_option('select[data-act=cause]', 'K')
        await pg.click('[data-act=confirm]'); await pg.wait_for_timeout(400)
        await pg.screenshot(path='dev/shots/5_saved.png', full_page=True)
        for t in ['brief', 'stu', 'chk']:
            await pg.click('#t-' + t); await pg.wait_for_timeout(400)
            await pg.screenshot(path=f'dev/shots/6_{t}.png', full_page=True)
        m = await b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        await m.route('https://fonts.googleapis.com/**', fonts)
        await m.goto(BASE + '/app.html'); await m.wait_for_timeout(600)
        await m.click('#t-dx'); await m.wait_for_timeout(300)
        await m.screenshot(path='dev/shots/7_mobile.png', full_page=True)
        w = await m.evaluate("document.documentElement.scrollWidth")
        print('mobile scrollWidth', w)
        print('errors', errs)
        await b.close()
asyncio.run(main())
