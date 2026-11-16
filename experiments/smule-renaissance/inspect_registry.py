import json, urllib.request
url='https://huggingface.co/api/models/smulelabs/Smule-Renaissance-Small?blobs=true'
with urllib.request.urlopen(url,timeout=60) as response: data=json.load(response)
print(json.dumps({'revision':data.get('sha'),'license':data.get('cardData',{}).get('license'),'files':data.get('siblings',[])},indent=2))
