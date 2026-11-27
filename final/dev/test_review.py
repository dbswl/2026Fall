# 가림 확인: 올리면 확인 창 → 편집 취소/적용 → 빼기 → 진단 시작 (AI 응답은 가짜)
import asyncio, json
from playwright.async_api import async_playwright
BASE = 'http://localhost:3999'
posts = []
async def handle(route):
    if route.request.method != 'POST': return await route.continue_()
    posts.append(1)
    await route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'result': {'questions': [
        {'no': '1', 'student_answer': '④', 'correct_answer': '④', 'verdict': 'correct', 'topic': '소인수분해', 'unit': '소인수분해'}]}}))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 390, 'height': 844})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.route('https://fonts.googleapis.com/**', lambda r: r.abort()); await pg.route('**/api/diagnose', handle)
        await pg.goto(BASE + '/app.html'); await pg.evaluate('localStorage.clear()'); await pg.reload(); await pg.wait_for_timeout(700)
        await pg.fill('#gName', '확인반'); await pg.click('#gCreate'); await pg.wait_for_timeout(300)
        await pg.set_input_files('#file', ['dev/real/p1.png', 'dev/real/p2.png', 'dev/real/p3.png']); await pg.wait_for_timeout(1200)
        print('review open:', await pg.locator('#reviewDlg').is_visible(), '| tiles:', await pg.locator('.rgrid figure').count(), '| posts:', len(posts))
        await pg.screenshot(path='dev/shots/v1_review.png')
        # 편집 열었다가 취소 → 그대로
        await pg.click('[data-rv-edit] >> nth=0'); await pg.wait_for_timeout(300); await pg.click('[data-r=cancel]'); await pg.wait_for_timeout(200)
        print('after cancel:', [' '.join(t.split()) for t in await pg.locator('.rgrid figcaption').all_inner_texts()])
        # 편집해서 가림 하나 지우고 적용
        await pg.click('[data-rv-edit] >> nth=0'); await pg.wait_for_timeout(300); await pg.click('[data-r=clear]'); await pg.click('[data-r=ok]'); await pg.wait_for_timeout(300)
        print('after apply:', [' '.join(t.split()) for t in await pg.locator('.rgrid figcaption').all_inner_texts()])
        # 세 번째 사진 빼기
        await pg.click('[data-rv-del] >> nth=2'); await pg.wait_for_timeout(200)
        print('tiles after remove:', await pg.locator('.rgrid figure').count(), '| start label:', await pg.text_content('[data-rv=start]'))
        # 나중에 → 진단하기 버튼이 확인 창을 다시 연다
        await pg.click('[data-rv=later]'); await pg.wait_for_timeout(200)
        print('go label:', await pg.text_content('#go'), '| posts:', len(posts))
        await pg.click('#go'); await pg.wait_for_timeout(200); print('reopened:', await pg.locator('#reviewDlg').is_visible())
        await pg.click('[data-rv=start]'); await pg.wait_for_function("!document.querySelector('#go').textContent.includes('진단 중')", timeout=30000); await pg.wait_for_timeout(300)
        print('posts:', len(posts), '| rows:', [' '.join(t.split()) for t in await pg.locator('.qmeta').all_inner_texts()])
        print('edit buttons left:', await pg.locator('[data-edit-item],[data-rv-edit]').count())
        print('errors', errs); await b.close()
asyncio.run(main())
