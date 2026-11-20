import asyncio
from playwright.async_api import async_playwright
BASE='http://localhost:3999'
async def fonts(route):
    if 'fonts.googleapis.com' in route.request.url: await route.fulfill(status=302, headers={'location': BASE+'/dev/fonts/index.css'})
    else: await route.abort()
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); errs=[]
        for w,h,name,dsf in [(1280,900,'land_desk',1),(390,844,'land_mob',2)]:
            pg=await b.new_page(viewport={'width':w,'height':h},device_scale_factor=dsf)
            pg.on('pageerror',lambda e: errs.append(str(e)))
            await pg.route('https://fonts.googleapis.com/**',fonts); await pg.route('https://fonts.gstatic.com/**',lambda r:r.abort())
            await pg.goto(BASE+'/index.html'); await pg.wait_for_timeout(700)
            await pg.screenshot(path=f'dev/shots/{name}.png',full_page=True)
            print(name, await pg.evaluate('document.documentElement.scrollWidth'))
        print(errs); await b.close()
asyncio.run(main())
