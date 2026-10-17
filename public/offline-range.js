// Full committed cache response -> media Range response. Shared with SW tests.
export async function audioRange(response, rangeHeader) {
 if(!rangeHeader)return response;
 const bytes=await response.arrayBuffer();const size=bytes.byteLength;
 const match=/^bytes=(\d*)-(\d*)$/i.exec(rangeHeader);
 const invalid=()=>new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`,'Accept-Ranges':'bytes'}});
 if(!match||(!match[1]&&!match[2]))return invalid();
 let start,end;
 if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)return invalid();start=Math.max(0,size-suffix);end=size-1;}
 else{start=Number(match[1]);end=match[2]?Math.min(size-1,Number(match[2])):size-1;}
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return invalid();
 return new Response(bytes.slice(start,end+1),{status:206,headers:{'Content-Type':'audio/mpeg','Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':String(end-start+1),'Accept-Ranges':'bytes'}});
}
