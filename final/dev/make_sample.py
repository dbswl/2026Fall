# 테스트용 '손글씨 풀이 사진' 만들기 (학생 B, 12번: 마지막 줄 계산 실수)
import asyncio
from playwright.async_api import async_playwright
HTML = """<html><head><meta charset=utf-8><link rel=stylesheet href="/dev/fonts/index.css"><style>
body{margin:0;background:#cfc8b8}
.p{margin:40px;width:760px;padding:30px 50px;background:#fbfaf3;transform:rotate(-1.6deg);box-shadow:0 10px 30px rgba(0,0,0,.35);
background-image:repeating-linear-gradient(to bottom,transparent 0,transparent 55px,#b9cbe2 55px,#b9cbe2 57px);font-family:'Nanum Pen Script';color:#233150;font-size:46px;line-height:57px}
.n{font-size:30px;color:#555}
</style></head><body><div class=p>
<div class=n>12. 집↔도서관, 갈 때 4km/h, 올 때 6km/h, 1시간 15분</div>
<div>x/4 + x/6 = 5/4</div><div>3x + 2x = 15</div><div>5x = 15</div><div>x = 5</div><div>답 5 km</div>
</div></body></html>"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':900,'height':560})
        await pg.route('**/sample.html', lambda r: r.fulfill(body=HTML.encode('utf-8'), content_type='text/html; charset=utf-8'))
        await pg.goto('http://localhost:3999/sample.html'); await pg.wait_for_timeout(600)
        await pg.screenshot(path='dev/sample_b12.jpg', type='jpeg', quality=85); await b.close()
asyncio.run(main())
