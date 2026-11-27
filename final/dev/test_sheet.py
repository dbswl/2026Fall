# 시험지 번호 지정 진단 흐름 (AI 응답은 가짜로 대신함)
import asyncio, json
from playwright.async_api import async_playwright
BASE = 'http://localhost:3999'
FAKE = {
  '12': dict(problem_text='12. 두 순서쌍 (a-2, 2b-7)과 (4-a, 2-b)가 서로 같을 때, a+b의 값은?\n① -6 ② -2 ③ 2 ④ 4 ⑤ 6', correct_answer='⑤ 6',
             transcribed_lines=['a-2=4-a', '2a=6, a=3', '2b-7=2-b', '3b=9, b=3', 'a+b=6'], student_answer='⑤ 6', is_correct=True, first_error_line=-1, cause='none'),
  '9': dict(problem_text='9. x에 대한 다음 두 방정식의 해가 같을 때, 상수 a의 값은?', correct_answer='③ -1',
            transcribed_lines=['7x-3=5x+13', '2x=16, x=8', '(8a-6)/2=5', '8a-6=10', 'a=-2'], student_answer='② -2', is_correct=False, first_error_line=0, cause='K', topic='계수가 소수인 일차방정식', unit='일차방정식', question_region={'x':0.05,'y':0.14,'w':0.45,'h':0.17}),
}
async def handle(route):
    req = route.request
    if req.method != 'POST': return await route.continue_()
    b = json.loads(req.post_data); no = b.get('question_no'); assert 'problem' not in b
    if no not in FAKE: return await route.fulfill(status=422, content_type='application/json', body=json.dumps({'error': 'question_not_found', 'message': f'{no}번 문항을 사진에서 찾지 못했습니다'}))
    r = dict(stopped_midway=False, evidence='0.7x를 7x로 옮기며 우변을 10배 하지 않음' if no == '9' else '', correct_line='7x-3=5x+130' if no == '9' else '',
             confidence=0.82, legibility='partial', teacher_note='양변에 같은 수를 곱할 때 모든 항에 곱하기', similar_problem={'text': '0.3x-0.2=0.1x+1.4의 해는?', 'answer': 'x=8'}, question_found=True, **FAKE[no])
    await asyncio.sleep(0.3)
    await route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'result': r}))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 1280, 'height': 900})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.route('https://fonts.googleapis.com/**', lambda r: r.abort())
        await pg.route('**/api/diagnose', handle)
        await pg.goto(BASE + '/app.html'); await pg.evaluate('localStorage.clear()'); await pg.reload(); await pg.wait_for_timeout(800)
        await pg.fill('#gName', '테스트 반'); await pg.click('#gCreate'); await pg.wait_for_timeout(300)
        print('status', await pg.text_content('#aiStatus'))
        await pg.click('#t-dx'); await pg.click('details.opt summary'); await pg.fill('#sexam', '3분기 진단평가'); await pg.fill('#snos', '9, 12, 99')
        await pg.select_option('#ssel', 'B')
        await pg.set_input_files('#file', ['dev/real/p2.png']); await pg.wait_for_timeout(1000)
        print('rows', [t.replace('\n', ' ') for t in await pg.locator('.qmeta').all_inner_texts()])
        await pg.click('[data-rv=start]'); await pg.wait_for_function("!document.querySelector('#go').textContent.includes('진단 중')", timeout=30000); await pg.wait_for_timeout(400)
        print('states', [t.strip() for t in await pg.locator('.qstate').all_inner_texts()])
        await pg.screenshot(path='dev/shots/s1_result.png', full_page=True)
        # 9번 진단서 보고 반영
        await pg.click('.qrow2 >> nth=0 >> img'); await pg.wait_for_timeout(300)
        print('card9:', (await pg.text_content('#dxOut'))[:260].replace('\n', ' '))
        await pg.screenshot(path='dev/shots/s2_q9.png', full_page=True)
        await pg.click('[data-act=confirm]'); await pg.wait_for_timeout(300)
        await pg.click('.qrow2 >> nth=1 >> img'); await pg.wait_for_timeout(300); await pg.click('[data-act=confirm]'); await pg.wait_for_timeout(300)
        await pg.click('.qrow2 >> nth=2 >> img'); await pg.wait_for_timeout(300)
        print('card99:', (await pg.text_content('#dxOut'))[:120].replace('\n', ' '))
        for t in ['brief', 'stu', 'chk']:
            await pg.click('#t-' + t); await pg.wait_for_timeout(300)
            if t == 'stu': await pg.click('[data-stu="B"]'); await pg.wait_for_timeout(200)
            await pg.screenshot(path=f'dev/shots/s3_{t}.png', full_page=True)
        await pg.click('#t-stu'); await pg.click('[data-stu="B"]'); await pg.wait_for_timeout(200); await pg.screenshot(path='dev/shots/s4_stuB.png', full_page=True)
        print('grid head', (await pg.locator('table.grid thead').inner_text()).split())
        print('B:', await pg.evaluate("(d => d.groups.find(g => g.id === d.cur).graded.B)(JSON.parse(localStorage.getItem('handline.groups')))"))
        print('errors', errs); await b.close()
asyncio.run(main())
