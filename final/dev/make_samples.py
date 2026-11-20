# 여러 유형의 테스트 '손글씨 풀이 사진' 만들기
import asyncio, sys
from playwright.async_api import async_playwright
CASES = {
 'a12_concept': ('12. 집↔도서관 4km/h, 6km/h, 1시간 15분', ['x/4 + x/6 = 1.15', '3x + 2x = 13.8', '5x = 13.8', 'x = 2.76', '답 2.76 km'], -1.2),
 'c12_misread': ('12. 거리를 구하시오', ['x/4 + x/6 = 5/4', '3x + 2x = 15', '5x = 15', 'x = 3', '답 3시간'], 1.0),
 'e11_misread': ('11. 연속하는 세 자연수의 합 57, 가장 큰 수?', ['x + (x+1) + (x+2) = 57', '3x + 3 = 57', '3x = 54', 'x = 18', '답 18'], -0.8),
 'g12_correct': ('12.', ['x/4 + x/6 = 5/4', '3x + 2x = 15', '5x = 15', 'x = 3', '답 3 km'], 1.4),
 'h9_concept': ('9. 3x - 5 = x + 7', ['3x - x = 7 - 5', '2x = 2', 'x = 1'], -1.5),
}
TPL = """<html><head><meta charset=utf-8><link rel=stylesheet href="/dev/fonts/index.css"><style>
body{margin:0;background:#c9c2b2}
.p{margin:40px;width:760px;padding:30px 50px;background:#fbfaf3;transform:rotate(%sdeg);box-shadow:0 10px 30px rgba(0,0,0,.35);
background-image:repeating-linear-gradient(to bottom,transparent 0,transparent 55px,#b9cbe2 55px,#b9cbe2 57px);font-family:'Nanum Pen Script';color:#233150;font-size:46px;line-height:57px}
.n{font-size:30px;color:#555}</style></head><body><div class=p><div class=n>%s</div>%s</div></body></html>"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':900,'height':560})
        for name,(head,lines,rot) in CASES.items():
            html = TPL % (rot, head, ''.join(f'<div>{l}</div>' for l in lines))
            await pg.goto('http://localhost:3999/app.html')
            await pg.set_content(html); await pg.wait_for_timeout(500)
            await pg.screenshot(path=f'dev/{name}.jpg', type='jpeg', quality=85)
        await b.close()
asyncio.run(main())
