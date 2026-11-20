import base64,json,urllib.request,time,sys
img='data:image/jpeg;base64,'+base64.b64encode(open(sys.argv[1],'rb').read()).decode()
d={'image':img,'problem':sys.argv[2],'answer':sys.argv[3]}
t=time.time()
r=urllib.request.Request('http://localhost:3999/api/diagnose',data=json.dumps(d).encode(),headers={'content-type':'application/json'})
try: print(json.dumps(json.loads(urllib.request.urlopen(r,timeout=170).read().decode()),ensure_ascii=False,indent=1))
except urllib.error.HTTPError as e: print(e.code, e.read().decode())
print('sec',round(time.time()-t,1))
