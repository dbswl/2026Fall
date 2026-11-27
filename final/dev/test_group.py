# 반 만들기 · 반 관리 · 반 바꾸기
import asyncio
from playwright.async_api import async_playwright
BASE = 'http://localhost:3999'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 390, 'height': 844})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.route('https://fonts.googleapis.com/**', lambda r: r.abort())
        await pg.goto(BASE + '/app.html'); await pg.evaluate('localStorage.clear()'); await pg.reload(); await pg.wait_for_timeout(800)
        print('tabs hidden:', await pg.locator('#tabs').is_hidden(), '| new panel:', await pg.locator('#p-new').is_visible())
        await pg.screenshot(path='dev/shots/g1_new.png', full_page=True)
        await pg.click('#gCreate'); await pg.wait_for_timeout(200); print('toast(no name):', await pg.text_content('.toast'))
        await pg.fill('#gName', '중1 월수반'); await pg.select_option('#gCount', '5'); await pg.wait_for_timeout(200)
        print('names:', await pg.eval_on_selector_all('[data-gi]', 'e => e.map(x => x.value)'))
        await pg.fill('[data-gi="2"]', '3번'); await pg.select_option('#gCount', '6'); await pg.wait_for_timeout(200)
        print('names after 6:', await pg.eval_on_selector_all('[data-gi]', 'e => e.map(x => x.value)'))
        await pg.screenshot(path='dev/shots/g2_filled.png', full_page=True)
        await pg.click('#gCreate'); await pg.wait_for_timeout(400)
        print('group sel:', await pg.eval_on_selector_all('#grpSel option', 'e => e.map(x => x.textContent)'))
        print('students:', await pg.eval_on_selector_all('#ssel option', 'e => e.map(x => x.textContent)'))
        await pg.screenshot(path='dev/shots/g3_dx.png', full_page=True)
        for t in ['brief', 'stu', 'chk']:
            await pg.click('#t-' + t); await pg.wait_for_timeout(200)
            print(t, '|', ' '.join((await pg.text_content('#p-' + t)).split())[:80])
        # 반 관리: B → 민수, E 빼기, 학생 추가
        await pg.click('#grpEdit'); await pg.wait_for_timeout(200)
        await pg.fill('[data-ge="1"]', '민수'); await pg.click('[data-gdel="4"]'); await pg.click('[data-gact=add]'); await pg.wait_for_timeout(100)
        await pg.screenshot(path='dev/shots/g4_manage.png')
        await pg.click('[data-gact=save]'); await pg.wait_for_timeout(300)
        print('after manage:', await pg.eval_on_selector_all('#grpSel option', 'e => e.map(x => x.textContent)'))
        await pg.click('#t-stu'); await pg.wait_for_timeout(200)
        print('chips:', [' '.join(t.split()) for t in await pg.locator('.chip').all_inner_texts()])
        # 두 번째 반 + 샘플 반
        await pg.select_option('#grpSel', '__new'); await pg.wait_for_timeout(200)
        print('new panel again:', await pg.locator('#p-new').is_visible(), '| cancel:', await pg.locator('#gCancel').count())
        await pg.click('#gSample'); await pg.wait_for_timeout(400)
        print('groups:', await pg.eval_on_selector_all('#grpSel option', 'e => e.map(x => x.textContent)'))
        await pg.click('#t-brief'); await pg.wait_for_timeout(200)
        print('sample brief kpi:', [' '.join(t.split()) for t in await pg.locator('.kpi').all_inner_texts()][:2])
        await pg.reload(); await pg.wait_for_timeout(600)
        print('after reload selected:', await pg.eval_on_selector('#grpSel', 'e => e.options[e.selectedIndex].textContent'))
        # 처음 반으로 돌아가 삭제
        v = await pg.eval_on_selector('#grpSel', 'e => e.options[0].value'); await pg.select_option('#grpSel', v); await pg.wait_for_timeout(300)
        pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pg.click('#grpEdit'); await pg.click('[data-gact=delgroup]'); await pg.wait_for_timeout(400)
        print('after delete:', await pg.eval_on_selector_all('#grpSel option', 'e => e.map(x => x.textContent)'))
        await pg.click('#resetBtn'); await pg.wait_for_timeout(400)
        print('after reset new panel:', await pg.locator('#p-new').is_visible(), '| scrollW', await pg.evaluate('document.documentElement.scrollWidth'))
        print('errors', errs); await b.close()
asyncio.run(main())
