# 휴대폰 화면: 반영하면 다음 진단서로 넘어가고, 모두 반영하면 완료 카드 (AI 응답은 가짜)
import asyncio, json
from playwright.async_api import async_playwright
BASE = 'http://localhost:3999'
SCAN = {'questions': [
  {'no': '24', 'x': .05, 'y': .6, 'w': .45, 'h': .3, 'student_answer': '-150', 'verdict': 'wrong', 'topic': '새로 정의한 연산', 'unit': '정수와 유리수'},
  {'no': '25', 'x': .05, 'y': .1, 'w': .45, 'h': .2, 'student_answer': '30/7', 'verdict': 'correct', 'topic': '기약분수', 'unit': '소인수분해'},
  {'no': '26', 'x': .05, 'y': .3, 'w': .45, 'h': .2, 'student_answer': '3600', 'verdict': 'unsure', 'topic': '원가·정가', 'unit': '일차방정식'}]}
def diag(no):
    return dict(question_found=True, problem_text=f'{no}. 문제', correct_answer='-75', transcribed_lines=['-15-5', '-75', '-150'], student_answer='-150',
        is_correct=False, first_error_line=2, stopped_midway=False, cause='K', evidence='곱셈 실수', correct_line='-75', confidence=.8 if no == '24' else .6,
        legibility='good', teacher_note='', similar_problem={'text': '연습 문제', 'answer': '1'}, topic='새로 정의한 연산', unit='정수와 유리수')
async def handle(route):
    if route.request.method != 'POST': return await route.continue_()
    b = json.loads(route.request.post_data); await asyncio.sleep(.2)
    body = {'ok': True, 'result': SCAN if b.get('scan') else diag(b['question_no'])}
    await route.fulfill(status=200, content_type='application/json', body=json.dumps(body))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.route('https://fonts.googleapis.com/**', lambda r: r.abort()); await pg.route('**/api/diagnose', handle)
        await pg.goto(BASE + '/app.html'); await pg.evaluate('localStorage.clear()'); await pg.reload(); await pg.wait_for_timeout(700)
        await pg.fill('#gName', '월수반'); await pg.fill('[data-gi="0"]', '동우'); await pg.click('#gCreate'); await pg.wait_for_timeout(300)
        await pg.set_input_files('#file', ['dev/real/p4.png']); await pg.wait_for_timeout(1000)
        await pg.click('[data-rv=start]'); await pg.wait_for_function("!document.querySelector('#go').textContent.includes('진단 중')", timeout=30000); await pg.wait_for_timeout(300)
        print('pager:', ' '.join((await pg.text_content('.pager')).split()))
        await pg.click('#resCard [data-act=confirm]'); await pg.wait_for_timeout(500)
        print('toast:', await pg.text_content('.toast'), '| pager:', ' '.join((await pg.text_content('.pager')).split()))
        await pg.screenshot(path='dev/shots/m1_after_confirm.png')
        await pg.click('#resCard [data-act=confirm]'); await pg.wait_for_timeout(400)
        await pg.click('#resCard [data-act=confirm]'); await pg.wait_for_timeout(500)
        print('toast:', await pg.text_content('.toast'))
        print('done card:', ' '.join((await pg.text_content('.done-card')).split()))
        await pg.locator('.done-card').scroll_into_view_if_needed(); await pg.wait_for_timeout(200)
        await pg.screenshot(path='dev/shots/m2_done.png')
        await pg.click('[data-act=nextsheet]'); await pg.wait_for_timeout(400)
        print('queue after next sheet:', await pg.locator('.qrow2').count(), '| scrollY', await pg.evaluate('scrollY'))
        print('errors', errs); await b.close()
asyncio.run(main())
