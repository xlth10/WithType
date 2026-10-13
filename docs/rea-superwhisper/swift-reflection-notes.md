# Superwhisper 主程序 Swift 反射元数据笔记

记录日期：2026-10-09。分析对象为主线程从官方 DMG 复制的 Superwhisper 2.19.2；本支线仅静态读取主程序，未启动目标、调用 GUI、读取用户数据或执行应用脚本。本文件只保存字段名、类型信息、地址与复现方法，不保存专有提示词的正文。

## 输入与地址口径

- 输入：`/private/tmp/rea-superwhisper-input/superwhisper.app/Contents/MacOS/superwhisper`
- Bundle ID：`com.superduper.superwhisper`；`CFBundleShortVersionString` 与 `CFBundleVersion` 均为 `2.19.2`（读取该包的 `Contents/Info.plist`）。
- Universal 主程序大小：49,091,296 bytes。
- **Universal 主程序 SHA-256：`0e70c211e0c7a65e09af5d3565e6d5827b62a5247721fa61f8ec981c9e94fd5a`**。
- 以下地址均为 **arm64 切片的首选虚拟地址，未加 ASLR slide**，不是 Universal 文件偏移，也不是字段在实例对象中的内存偏移。arm64 切片起始文件偏移 `0x17cc000`，大小 `0x17052e0`。
- `__TEXT,__swift5_fieldmd` 起始 VA `0x10129eb7c`，大小 162,384 bytes；切片内文件偏移 19,524,476。完整遍历得到 2,772 个字段描述符，结束 VA 精确为 `0x1012c65cc`。
- `__TEXT,__swift5_reflstr` 起始 VA `0x10127e010`；`__TEXT,__swift5_typeref` 起始 VA `0x101134360`。

## 已确认的字段归属

下表由本二进制的 FieldDescriptor / FieldRecord 与 nominal type context descriptor 直接读取。每个列出的 nominal descriptor 的 `Fields` 相对指针都反向指向对应 FieldDescriptor，作为独立一致性检查。

| 类型 | nominal type context descriptor VA | FieldDescriptor VA | 相关字段 |
|---|---|---|---|
| `superwhisper.Mode`（struct） | `0x10122a140` | `0x1012a369c` | `prompt`、`promptExamples`、`contextTemplate`、`contextFromSelection`、`contextFromClipboard`、`contextFromActiveApplication`、`activationApps`、`activationSites`、`script`、`scriptEnabled` |
| `superwhisper.PromptContext`（struct） | `0x101234c80` | `0x1012adc9c` | `modeContext`、`systemContext`、`userContext`、`applicationContext` |
| `superwhisper.ModeContext`（struct） | `0x101234d54` | `0x1012adcdc` | `type`、`language`、`examples` |
| `superwhisper.SystemContext`（struct） | `0x101234d38` | `0x1012add10` | `time`、`timezone`、`locale`、`language`、`computerName`、`clipboard` |
| `superwhisper.UserContext`（struct） | `0x101234d1c` | `0x1012add68` | `fullName`、`email`、`phone` |
| `superwhisper.ApplicationContext`（struct） | `0x101234d00` | `0x1012add9c` | `name`、`url`、`nouns`、`focusedElementDescription`、`focusedElementContent`、`selectedText`、`appInfo`、`includeInPrompt` |
| `superwhisper.RecordingMetadata`（class） | `0x1012286b8` | `0x1012a265c` | `applicationContextEnabled`、`prompt`、`promptContext`，以及录音结果与历史信息 |
| `superwhisper.ModelConfiguration`（struct） | `0x10122b524` | `0x1012a4c0c` | 模型/provider/host/chatTemplate 配置；没有上述上下文开关字段 |

关键单字段的可定位证据：

| 所属类型 / 字段 | FieldRecord VA | 字段名字串 VA | type-ref VA / 已解码类型 |
|---|---|---|---|
| `Mode.contextFromSelection` | `0x1012a3784` | `0x1012826c0` | `0x1011501e8` / Bool（`Sb`） |
| `Mode.contextFromClipboard` | `0x1012a3790` | `0x1012826e0` | `0x1011501e8` / Bool |
| `Mode.contextFromActiveApplication` | `0x1012a379c` | `0x101282700` | `0x1011501e8` / Bool |
| `RecordingMetadata.applicationContextEnabled` | `0x1012a2738` | `0x1012816b0` | `0x1011501e8` / Bool |
| `RecordingMetadata.promptContext` | `0x1012a2750` | `0x1012816d1` | `0x101135932` / `PromptContext?` |
| `ApplicationContext.selectedText` | `0x1012adde8` | `0x10128d036` | `0x1011586cc` / String?（`SSSg`） |
| `ApplicationContext.includeInPrompt` | `0x1012ade00` | `0x10128d04b` | `0x1011501e8` / Bool |
| `SystemContext.clipboard` | `0x1012add5c` | `0x10128cfcc` | `0x1011586cc` / String? |

`selectedText` 也出现在诊断结构 `superwhisper.DebugInfo`（nominal descriptor `0x10123496c`，FieldDescriptor `0x1012ad6ec`，FieldRecord `0x1012ad708`）。这是另一份字段，不应仅凭共用词名推断其用途。

`Mode.CodingKeys`（FieldDescriptor `0x1012a3908`）也包含三个 `contextFrom...` 名称；`ApplicationContext.CodingKeys`（`0x1012adf58`）包含 `selectedText` 等八个同名键。它们证明编译产物里存在对应编码键，尚不能单独证明某个请求必然使用全部字段。

## 名称纠正与证据边界

- **`applicationContextEnabled` 的准确归属是 `RecordingMetadata`，不是 `Mode`。** arm64 切片有三个同名字面量位置：`0x1010cb2a0`、`0x101262e70`、`0x1012816b0`；反射字段归属由最后一个名字串及其 FieldRecord 确定。
- **未发现精确名 `clipboardContextEnabled` 或 `selectedTextContextEnabled` 的反射字段；arm64 切片的对应字节串计数均为 0。** 实际模式字段分别是 `contextFromClipboard` 与 `contextFromSelection`。这只约束当前输入版本与所检查切片。
- 2,772 个字段描述符中没有精确类型 `superwhisper.ModeConfiguration`；存在 `superwhisper.Mode` 和 `superwhisper.ModelConfiguration`。第三方 GRDB 的 `JournalModeConfiguration` 与此无关。
- 字段与类型元数据证明数据结构的存在与归属。它们**不能证明**采集时机、默认开关、隐私过滤、模板填充方式、最终发送的字段、请求角色顺序或 provider 行为；这些仍需调用关系、反编译或隔离运行实证。字段名中的 `includeInPrompt` 也不能代替实际分支验证。

## 解析方法

1. 读取 Universal FAT header，选取 CPU type `0x0100000c` 的 arm64 Mach-O64 切片。解析 `LC_SEGMENT_64`，建立切片文件偏移与首选 VA 的映射。
2. 按字段头部的 `FieldRecordSize` 与 `NumFields` 遍历 `__swift5_fieldmd`：当前头部 16 bytes，记录 12 bytes。每个相对地址的基准是**该相对指针自身的地址**。字段名来自 FieldRecord 的 `FieldName`，不是全局字符串搜索。[Swift 官方 FieldDescriptor / FieldRecord 定义](https://github.com/swiftlang/swift/blob/main/include/swift/RemoteInspection/Records.h)
3. `MangledTypeName` 在本输入中经常以 `0x01` 或 `0x02` 加四字节相对引用开头，分别直接或间接指向 context descriptor。引用字节内可含 NUL，不能用普通 C-string 截断类型名。通过 context descriptor 的名称与父级恢复 `superwhisper.Type`；本脚本只解析本次需要的 context 引用。[Swift 官方 symbolic reference 规则](https://github.com/swiftlang/swift/blob/main/docs/ABI/Mangling.rst#symbolic-references)
4. 先解析 `LC_DYLD_CHAINED_FIXUPS`。当前相关 segment 的 pointer format 均为 6（`DYLD_CHAINED_PTR_64_OFFSET`）；按页起点和 `next * 4` 遍历，验证 98,984 个真实 chained pointer sites。间接引用的 on-disk 数值包含链信息，不能直接当作 VA；读取 rebase 的 36-bit target offset 后加 image base，保留 high8。脚本遇到 external bind 会停止解析该引用，不伪造目标地址。[Apple 官方 fixup 格式](https://github.com/apple-oss-distributions/dyld/blob/main/include/mach-o/fixup-chains.h)
5. 对本笔记列出的 nominal type descriptors，检查 offset +16 的 `Fields` 相对指针回指 FieldDescriptor；结果全部匹配。所有读取都由本地 Python 标准库完成，不执行 Swift 或目标机器码。

下列复现器只打印所选类型的字段元数据；不读取字段实例值、不导出提示词内容。它是为此输入编写的有边界解析器，明确拒绝其他 chained pointer formats 和 multi-start pages，不能宣称通用 Swift demangler。可将代码复制到临时脚本，使用本机 Python 3 运行：

```python
import struct,json,hashlib
from pathlib import Path
p=Path('/private/tmp/rea-superwhisper-input/superwhisper.app/Contents/MacOS/superwhisper')
b=p.read_bytes(); magic,narch=struct.unpack_from('>II',b,0)
assert magic==0xcafebabe
arches=[struct.unpack_from('>IIIII',b,8+20*i) for i in range(narch)]
base,size=next((a[2],a[3]) for a in arches if a[0]==0x100000c)
s=b[base:base+size]; head=struct.unpack_from('<IIIIIIII',s,0)
assert head[0]==0xfeedfacf
segments=[]; sections={}; off=32
for i in range(head[4]):
    cmd,cmdsize=struct.unpack_from('<II',s,off)
    if cmd==0x19:
        vals=struct.unpack_from('<II16sQQQQiiII',s,off)
        segname=vals[2].split(b'\0')[0].decode(); segments.append((vals[3],vals[4],vals[5],vals[6],segname))
        for j in range(vals[9]):
            sec=struct.unpack_from('<16s16sQQIIIIIIII',s,off+72+j*80)
            name=sec[0].split(b'\0')[0].decode(); seg=sec[1].split(b'\0')[0].decode()
            sections[(seg,name)]=(sec[2],sec[3],sec[4])
    off+=cmdsize

def fo(vm):
    for a,vs,f,fs,name in segments:
        if a <= vm < a+fs: return f+vm-a
    raise ValueError(hex(vm))
def i32(vm):return struct.unpack_from('<i',s,fo(vm))[0]
def u32(vm):return struct.unpack_from('<I',s,fo(vm))[0]
def u64raw(vm):return struct.unpack_from('<Q',s,fo(vm))[0]
image_base=next(a for a,vs,f,fs,name in segments if name=='__TEXT')
# Read dyld starts, then walk each format-6 chain to identify actual pointer sites.
chain_sites=set(); off=32
for _ in range(head[4]):
    cmd,cmdsize=struct.unpack_from('<II',s,off)
    if cmd==0x80000034:
        _,_,dataoff,datasize=struct.unpack_from('<IIII',s,off)
        fh=struct.unpack_from('<7I',s,dataoff)
        starts=dataoff+fh[1]
        count=struct.unpack_from('<I',s,starts)[0]
        for j in range(count):
            info=struct.unpack_from('<I',s,starts+4+j*4)[0]
            if not info:continue
            st=starts+info
            _,page_size,fmt,segment_offset,_,page_count=struct.unpack_from('<IHHQIH',s,st)
            assert fmt==6, ('unsupported chained pointer format',fmt)
            for page in range(page_count):
                start=struct.unpack_from('<H',s,st+22+page*2)[0]
                if start==0xffff:continue
                assert not (start & 0x8000), 'this reproducer does not handle multi-start pages'
                vm=image_base+segment_offset+page*page_size+start
                for step in range(page_size//4):
                    chain_sites.add(vm)
                    raw=u64raw(vm); nxt=(raw>>51)&0xfff
                    if not nxt:break
                    vm+=nxt*4
                else:raise ValueError('unterminated pointer chain')
    off+=cmdsize

def u64(vm):
    assert vm in chain_sites, ('not a verified chain pointer',hex(vm))
    raw=u64raw(vm)
    if raw >> 63:raise ValueError(('external bind',hex(vm),hex(raw)))
    return image_base+(raw & ((1<<36)-1))+(((raw>>36)&255)<<56)
def rel(at): return at+i32(at)
def cs(at):
    f=fo(at); end=s.find(b'\0',f,min(len(s),f+1000)); return s[f:end if end>=0 else f+1000].decode('utf-8','backslashreplace')
def ctx_name(at,seen=None):
    seen=set() if seen is None else seen
    if not at or at in seen:return '?'
    seen.add(at); flags=u32(at); kind=flags & 31
    if kind in (0,16,17,18,3):
        name=cs(rel(at+8)); parent_rel=i32(at+4)
        if parent_rel:
            target=at+4+(parent_rel & ~1)
            parent=u64(target) if parent_rel & 1 else target
            return ctx_name(parent,seen)+'.'+name
        return name
    return '<context kind='+str(kind)+' at '+hex(at)+'>'
def type_info(at):
    # Most application field descriptors begin with a Swift symbolic context reference.
    f=fo(at); code=s[f]
    if code in (1,2):
        target=at+1+i32(at+1); desc=u64(target) if code==2 else target
        return {'name':ctx_name(desc),'context_descriptor':hex(desc),'symbolic_kind':code}
    return {'name':cs(at),'context_descriptor':None,'symbolic_kind':None}
addr,ss,ff=sections[('__TEXT','__swift5_fieldmd')]
x=addr; end=addr+ss; allrec=[]
while x+16<=end:
    mtype,superrel,kind,rs,n=struct.unpack_from('<iiHHI',s,fo(x))
    if not mtype or rs<12 or n>10000 or x+16+rs*n>end: raise ValueError(('descriptor',hex(x),mtype,kind,rs,n))
    typeaddr=x+mtype; info=type_info(typeaddr); fields=[]
    for j in range(n):
        at=x+16+j*rs; flags,tr,nr=struct.unpack_from('<Iii',s,fo(at))
        fields.append({'name':cs(at+8+nr) if nr else None,'record':hex(at),'name_address':hex(at+8+nr) if nr else None,'flags':hex(flags),'type_ref_address':hex(at+4+tr) if tr else None})
    allrec.append({'type':info['name'],'context_descriptor':info['context_descriptor'],'descriptor':hex(x),'type_address':hex(typeaddr),'kind':kind,'record_size':rs,'fields':fields})
    x+=16+rs*n
assert x==end

targets={
    'superwhisper.Mode','superwhisper.PromptContext','superwhisper.ApplicationContext',
    'superwhisper.ModeContext','superwhisper.SystemContext','superwhisper.UserContext',
    'superwhisper.RecordingMetadata','superwhisper.ModelConfiguration',
}
print('sha256',hashlib.sha256(b).hexdigest())
print('fieldmd',hex(addr),'size',ss,'descriptors',len(allrec))
print('arm64 slice',hex(base),hex(size),'chain_sites',len(chain_sites))
for rec in allrec:
    if rec['type'] not in targets:continue
    desc=int(rec['context_descriptor'],16)
    assert rel(desc+16)==int(rec['descriptor'],16)
    print(json.dumps(rec,ensure_ascii=False))
for name in ['applicationContextEnabled','clipboardContextEnabled','selectedTextContextEnabled']:
    print('literal_count_arm64',name,s.count(name.encode()))
print('application_ModeConfiguration',[
    r['type'] for r in allrec
    if r['type']=='superwhisper.ModeConfiguration'
])

```

