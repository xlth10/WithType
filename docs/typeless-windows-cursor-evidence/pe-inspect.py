from pathlib import Path
import struct,json,sys,re,hashlib
p=Path(sys.argv[1]);b=p.read_bytes();pe=struct.unpack_from('<I',b,0x3c)[0];ns=struct.unpack_from('<H',b,pe+6)[0];ops=struct.unpack_from('<H',b,pe+20)[0];op=pe+24;magic=struct.unpack_from('<H',b,op)[0];assert magic==0x20b
image=struct.unpack_from('<Q',b,op+24)[0];dirs=[struct.unpack_from('<II',b,op+112+i*8) for i in range(16)];sections=[]
for i in range(ns):
 s=op+ops+i*40; name=b[s:s+8].rstrip(b'\0').decode();vs,rva,size,off=struct.unpack_from('<IIII',b,s+8);sections.append(dict(name=name,rva=rva,virtual_size=vs,bytes=size,file_offset=off))
def offset(rva):
 for s in sections:
  if s['rva']<=rva<s['rva']+s['bytes']:return s['file_offset']+rva-s['rva']
 if rva<sections[0]['rva']:return rva
 raise ValueError(hex(rva))
def cstring(rva):
 f=offset(rva);return b[f:b.index(b'\0',f)].decode(errors='replace')
imports=[];rva,size=dirs[1]
for i in range(size//20+1):
 vals=struct.unpack_from('<IIIII',b,offset(rva)+20*i)
 if not any(vals):break
 oft,_,_,nr,iat=vals;dll=cstring(nr);entry=0
 while True:
  v=struct.unpack_from('<Q',b,offset(oft or iat)+8*entry)[0]
  if not v:break
  name='ordinal:'+str(v&0xffff) if v&(1<<63) else cstring(v+2)
  imports.append(dict(dll=dll,name=name,iat_rva=iat+8*entry,iat_va=hex(image+iat+8*entry)));entry+=1
exports=[];rva,size=dirs[0]
if rva:
 fields=struct.unpack_from('<IIHHIIIIIII',b,offset(rva));base,nf,nn,funcs,names,ords=fields[5:]
 for i in range(nn):
  nr=struct.unpack_from('<I',b,offset(names)+i*4)[0];idx=struct.unpack_from('<H',b,offset(ords)+i*2)[0];fr=struct.unpack_from('<I',b,offset(funcs)+idx*4)[0]
  exports.append(dict(name=cstring(nr),ordinal=base+idx,rva=fr,va=hex(image+fr)))
functions=[];rva,size=dirs[3]
for i in range(size//12):
 start,end,unwind=struct.unpack_from('<III',b,offset(rva)+12*i)
 if start:end>start and functions.append(dict(start=image+start,end=image+end,rva=start,end_rva=end,unwind_rva=unwind))
strings=[]
for s in sections:
 if s['name']=='.text':continue
 data=b[s['file_offset']:s['file_offset']+s['bytes']]
 for pat,enc in [(rb'[\x20-\x7e]{6,}','ascii'),(rb'(?:[\x20-\x7e]\x00){6,}','utf-16le')]:
  for m in re.finditer(pat,data):strings.append(dict(va=hex(image+s['rva']+m.start()),rva=s['rva']+m.start(),encoding=enc,value=m.group().decode(enc)))
result=dict(path=str(p),bytes=len(b),sha256=hashlib.sha256(b).hexdigest(),image_base=hex(image),sections=sections,exports=exports,imports=imports,runtime_functions=functions,strings=strings)
out=Path(sys.argv[2]);out.write_text(json.dumps(result,indent=2));print(json.dumps({k:len(result[k]) for k in ['exports','imports','runtime_functions','strings']}))
