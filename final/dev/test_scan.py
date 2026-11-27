# 시험지 전체 자동 진단 흐름 (AI 응답은 가짜): 한 학생의 2쪽 → 문항 찾기 → 오답·애매한 문항만 진단
import asyncio, json
from playwright.async_api import async_playwright
BASE = 'http://localhost:3999'
calls = []
SCAN = {'questions': [
  {'no': '9', 'region': {'x': .05, 'y': .14, 'w': .45, 'h': .17}, 'student_answer': '② -2', 'correct_answer': '③ -1', 'verdict': 'wrong', 'topic': '계수가 소수인 일차방정식', 'unit': '일차방정식', 'note': '답이 다름'},
  {'no': '10', 'region': {'x': .05, 'y': .31, 'w': .45, 'h': .15}, 'student_answer': '① -8/3', 'correct_answer': '① -8/3', 'verdict': 'correct', 'topic': '해가 없는 방정식', 'unit': '일차방정식', 'note': '고른 답이 정답과 같음'},
  {'no': '12', 'region': {'x': .05, 'y': .6, 'w': .45, 'h': .12}, 'student_answer': '⑤ 6', 'correct_answer': '⑤ 6', 'verdict': 'unsure', 'topic': '순서쌍', 'unit': '좌표평면과 그래프', 'note': '표시가 두 개'},
  {'no': '14', 'region': {'x': .5, 'y': .14, 'w': .45, 'h': .15}, 'student_answer': '③ 12', 'correct_answer': '③ 12', 'verdict': 'correct', 'topic': '반비례 관계식', 'unit': '정비례와 반비례', 'note': '정답'}]}
def diag(no, ok):
    return dict(question_found=True, problem_text=f'{no}. (사진에서 읽은 문제)', correct_answer='③ -1' if no == '9' else '⑤ 6',
        transcribed_lines=['7x-3=5x+13', '2x=16, x=8'] if no == '9' else ['a-2=4-a', 'a=3', 'b=3', 'a+b=6'], student_answer='② -2' if no == '9' else '⑤ 6',
        is_correct=ok, first_error_line=-1 if ok else 0, stopped_midway=False, cause='none' if ok else 'K', evidence='근거', correct_line='', confidence=.8,
        legibility='good', teacher_note='', similar_problem={'text': '연습', 'answer': '1'})
async def handle(route):
    req = route.request
    if req.method != 'POST': return await route.continue_()
    b = json.loads(req.post_data); calls.append({k: v for k, v in b.items() if k != 'image'})
    await asyncio.sleep(.3)
    if b.get('scan'): return await route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'result': SCAN}))
    no = b['question_no']
    await route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'result': diag(no, no == '12')}))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 1280, 'height': 900})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.route('https://fonts.googleapis.com/**', lambda r: r.abort()); await pg.route('**/api/diagnose', handle)
        await pg.goto(BASE + '/app.html'); await pg.evaluate('localStorage.clear()'); await pg.reload(); await pg.wait_for_timeout(800)
        await pg.fill('#gName', '테스트 반'); await pg.click('#gCreate'); await pg.wait_for_timeout(300)
        await pg.click('#t-dx'); await pg.select_option('#ssel', '학생 C')
        await pg.click('details.opt summary'); await pg.fill('#sans', '9:③')
        await pg.set_input_files('#file', ['dev/real/p2.png', 'dev/real/p3.png']); await pg.wait_for_timeout(1000)
        print('before:', [t.replace('\n', ' ') for t in await pg.locator('.qrow2').all_inner_texts()])
        print('go:', await pg.text_content('#go'))
        await pg.click('[data-rv=start]'); await pg.wait_for_timeout(200)
        await pg.wait_for_function("!document.querySelector('#go').textContent.includes('진단 중')", timeout=30000); await pg.wait_for_timeout(400)
        print('after:', [' '.join(t.split()) for t in await pg.locator('.qrow2').all_inner_texts()])
        print('calls:', calls)
        await pg.screenshot(path='dev/shots/t1_scan.png', full_page=True)
        # 빠른 정답 하나 보기
        await pg.click('.qrow2 >> nth=1 >> img'); await pg.wait_for_timeout(300)
        print('quick card:', ' '.join((await pg.text_content('#dxOut')).split())[:220])
        await pg.click('[data-act=confirmall]'); await pg.wait_for_timeout(300)
        print('left to confirm:', await pg.locator('[data-act=confirm]').count())
        await pg.click('#t-chk'); await pg.wait_for_timeout(300)
        print('grid head', (await pg.locator('table.grid thead').inner_text()).split())
        await pg.screenshot(path='dev/shots/t2_chk.png', full_page=True)
        print('errors', errs); await b.close()
asyncio.run(main())
