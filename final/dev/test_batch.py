# 여러 장 진단 · 점수 계산 · 체험 코드 흐름 확인
# 사용: python3 dev/test_batch.py demo   (키 없이 서버 실행)
#       python3 dev/test_batch.py code   (가짜 키 + ACCESS_CODE=test123 으로 서버 실행)
import asyncio, sys
from playwright.async_api import async_playwright
BASE = 'http://localhost:3999'
MODE = sys.argv[1] if len(sys.argv) > 1 else 'demo'
async def fonts(route):
    await route.fulfill(status=302, headers={'location': BASE + '/dev/fonts/index.css'})
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': 1280, 'height': 900})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('console:' + m.text) if m.type == 'error' else None)
        await pg.route('https://fonts.googleapis.com/**', fonts)
        await pg.route('https://fonts.gstatic.com/**', lambda r: r.abort())
        await pg.goto(BASE + '/app.html'); await pg.wait_for_timeout(600)
        await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_timeout(900)
        print('status:', await pg.text_content('#aiStatus'))
        if MODE == 'code':
            print('code box shown:', await pg.locator('#code').count())
            await pg.fill('#code', 'wrong'); await pg.click('[data-act=code]'); await pg.wait_for_timeout(600)
            print('after wrong code:', await pg.text_content('#aiStatus'))
            await pg.fill('#code', 'test123'); await pg.press('#code', 'Enter'); await pg.wait_for_timeout(600)
            print('after right code:', await pg.text_content('#aiStatus'), '| box left:', await pg.locator('#code').count())
            await b.close(); print('errors', errs); return
        # 반 평균 (샘플 그대로)
        await pg.click('#t-brief'); await pg.wait_for_timeout(300)
        print('KPI before:', [t.strip() for t in await pg.locator('.kpi').all_inner_texts()])
        await pg.click('#t-dx'); await pg.wait_for_timeout(300)
        # 12번 문항에 새 학생 I 부터 4장
        await pg.select_option('#qsel', '12'); await pg.select_option('#ssel', '__new'); await pg.fill('#sname', 'I')
        await pg.set_input_files('#file', ['dev/sample_b12.jpg', 'dev/a12_concept.jpg', 'dev/c12_misread.jpg', 'dev/g12_correct.jpg'])
        await pg.wait_for_timeout(800)
        print('queue students:', await pg.eval_on_selector_all('[data-item-s]', 'els => els.map(e => e.value)'))
        print('go label:', await pg.text_content('#go'))
        await pg.screenshot(path='dev/shots/b1_queue.png', full_page=True)
        await pg.click('#go'); await pg.wait_for_timeout(500)
        await pg.screenshot(path='dev/shots/b2_running.png', full_page=True)
        await pg.wait_for_function("!document.querySelector('#go') || !document.querySelector('#go').textContent.includes('진단 중')", timeout=30000)
        await pg.wait_for_timeout(300)
        print('states:', [t.strip() for t in await pg.locator('.qstate').all_inner_texts()])
        await pg.screenshot(path='dev/shots/b3_done.png', full_page=True)
        n = await pg.locator('[data-act=confirmall]').count()
        if n:
            print('confirmall:', await pg.text_content('[data-act=confirmall]'))
            await pg.click('[data-act=confirmall]'); await pg.wait_for_timeout(400)
        left = await pg.locator('[data-act=confirm]').count()
        print('individual confirm left:', left)
        while await pg.locator('[data-act=confirm]').count():
            await pg.click('[data-act=confirm]'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='dev/shots/b4_saved.png', full_page=True)
        await pg.click('#t-brief'); await pg.wait_for_timeout(300)
        print('KPI after:', [t.strip() for t in await pg.locator('.kpi').all_inner_texts()])
        await pg.click('#t-stu'); await pg.wait_for_timeout(300)
        await pg.click('[data-stu="I"]'); await pg.wait_for_timeout(300)
        print('I header:', await pg.text_content('#p-stu h2 + p'))
        await pg.screenshot(path='dev/shots/b5_stuI.png', full_page=True)
        await pg.click('#t-chk'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='dev/shots/b6_chk.png', full_page=True)
        # 다시 불러와도 유지되는지
        await pg.reload(); await pg.wait_for_timeout(700)
        await pg.click('#t-stu'); await pg.click('[data-stu="I"]'); await pg.wait_for_timeout(300)
        print('I after reload:', await pg.text_content('#p-stu h2 + p'))
        # 이전 버전 저장분(graded 없음) 이전
        await pg.evaluate("""() => { const j = JSON.parse(localStorage.getItem('handline.v1')); delete j.graded; localStorage.setItem('handline.v1', JSON.stringify(j)); }""")
        await pg.reload(); await pg.wait_for_timeout(700)
        await pg.click('#t-stu'); await pg.click('[data-stu="I"]'); await pg.wait_for_timeout(300)
        print('I after migration:', await pg.text_content('#p-stu h2 + p'))
        m = await b.new_page(viewport={'width': 390, 'height': 844})
        await m.route('https://fonts.googleapis.com/**', fonts)
        await m.goto(BASE + '/app.html'); await m.wait_for_timeout(500)
        await m.click('#t-dx'); await m.set_input_files('#file', ['dev/sample_b12.jpg', 'dev/a12_concept.jpg']); await m.wait_for_timeout(600)
        await m.screenshot(path='dev/shots/b7_mobile.png', full_page=True)
        print('mobile scrollWidth', await m.evaluate("document.documentElement.scrollWidth"))
        print('errors', errs)
        await b.close()
asyncio.run(main())
