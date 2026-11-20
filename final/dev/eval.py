import base64,json,urllib.request,time,sys,concurrent.futures as cf
P12='집에서 도서관까지 갈 때는 시속 4 km, 올 때는 시속 6 km로 걸었더니 모두 1시간 15분이 걸렸다. 집에서 도서관까지의 거리를 구하시오.'
CASES=[('a12_concept',P12,'3 km','C/0'),('c12_misread',P12,'3 km','R/4'),('g12_correct',P12,'3 km','정답'),
 ('e11_misread','연속하는 세 자연수의 합이 57일 때, 가장 큰 수를 구하시오.','20','R/3~4'),('h9_concept','일차방정식 3x − 5 = x + 7 을 푸시오.','x = 6','C/0')]
def run(c):
    name,prob,ans,exp=c
    img='data:image/jpeg;base64,'+base64.b64encode(open(f'dev/{name}.jpg','rb').read()).decode()
    t=time.time()
    r=urllib.request.Request('http://localhost:3999/api/diagnose',data=json.dumps({'image':img,'problem':prob,'answer':ans}).encode(),headers={'content-type':'application/json'})
    try: d=json.loads(urllib.request.urlopen(r,timeout=170).read().decode())['result']
    except urllib.error.HTTPError as e: return f'{name}: HTTP {e.code} {e.read().decode()}'
    return f"{name} (기대 {exp}) {round(time.time()-t,1)}s → 정답={d['is_correct']} 줄={d['first_error_line']} 원인={d['cause']} 신뢰도={d['confidence']}\n   판독 {d['transcribed_lines']}\n   근거 {d['evidence']}\n   바른 줄 {d['correct_line']} | 처방 {d['similar_problem']}"
with cf.ThreadPoolExecutor(3) as ex:
    for out in ex.map(run, CASES): print(out)
