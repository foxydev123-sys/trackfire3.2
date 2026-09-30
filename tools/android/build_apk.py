#!/usr/bin/env python3
"""
Builds a small Android app (APK) for Kurdish Tank with no Android SDK.

The app is a full-screen, landscape WebView that opens the game from your
server (SERVER_URL). A tiny start page (assets/start.html) shows a loading
screen while a sleeping Render server wakes up, and a retry button when
there is no internet.

Everything is written by hand here: classes.dex, the binary
AndroidManifest.xml, resources.arsc (for the icon) and the v2 APK signature.

Usage:
  python3 tools/android/build_apk.py --url https://trackfire1-6.onrender.com/ \
      --out kurdish-tank.apk --key tools/android/release-key.pem

Keep the key file! Android only installs an update over the old app when
it is signed with the same key.
"""
import argparse, hashlib, io, os, struct, zipfile, zlib, datetime

# ---------------------------------------------------------------- helpers
def u8(v): return struct.pack('<B', v)
def u16(v): return struct.pack('<H', v)
def u32(v): return struct.pack('<I', v & 0xffffffff)
def u64(v): return struct.pack('<Q', v)
def pad4(b): return b + b'\0' * (-len(b) % 4)

def uleb(v):
    out = bytearray()
    while True:
        b = v & 0x7f; v >>= 7
        if v: out.append(b | 0x80)
        else: out.append(b); return bytes(out)

NO_INDEX = 0xffffffff

# ================================================================ DEX
class Dex:
    """Minimal DEX (version 035) writer for one class."""

    def __init__(self):
        self.strings = set(); self.types = set(); self.protos = set()
        self.fields = set(); self.methods = set()

    # --- registration (collect everything first, then sort and index)
    def s(self, x): self.strings.add(x); return x
    def t(self, desc): self.s(desc); self.types.add(desc); return desc

    @staticmethod
    def shorty_char(desc): return 'L' if desc[0] in 'L[' else desc

    def proto(self, ret, params=()):
        self.t(ret); [self.t(p) for p in params]
        shorty = self.shorty_char(ret) + ''.join(self.shorty_char(p) for p in params)
        self.s(shorty)
        p = (shorty, ret, tuple(params)); self.protos.add(p); return p

    def field(self, cls, name, typ):
        self.t(cls); self.t(typ); self.s(name)
        f = (cls, name, typ); self.fields.add(f); return f

    def method(self, cls, name, ret, params=()):
        self.t(cls); self.s(name)
        m = (cls, name, self.proto(ret, params)); self.methods.add(m); return m

    # --- build
    def build(self, cls, super_cls, ifields, direct, virtual):
        """ifields: [(field, access)]; direct/virtual: [(method, access, regs, ins, outs, insns_fn)]
        insns_fn(ix) -> list of 16-bit code units, ix gives indices."""
        S = sorted(self.strings, key=lambda x: x.encode('utf-16-be'))
        si = {x: i for i, x in enumerate(S)}
        T = sorted(self.types, key=lambda d: si[d])
        ti = {x: i for i, x in enumerate(T)}
        P = sorted(self.protos, key=lambda p: (ti[p[1]], [ti[q] for q in p[2]]))
        pi = {x: i for i, x in enumerate(P)}
        F = sorted(self.fields, key=lambda f: (ti[f[0]], si[f[1]], ti[f[2]]))
        fi = {x: i for i, x in enumerate(F)}
        M = sorted(self.methods, key=lambda m: (ti[m[0]], si[m[1]], pi[m[2]]))
        mi = {x: i for i, x in enumerate(M)}
        ix = dict(s=si, t=ti, f=fi, m=mi)

        n_str, n_typ, n_pro, n_fld, n_met = len(S), len(T), len(P), len(F), len(M)
        off = 0x70
        str_ids_off = off; off += 4 * n_str
        typ_ids_off = off; off += 4 * n_typ
        pro_ids_off = off; off += 12 * n_pro
        fld_ids_off = off; off += 8 * n_fld
        met_ids_off = off; off += 8 * n_met
        cls_defs_off = off; off += 32
        data_off = off

        data = bytearray()
        def here(): return data_off + len(data)
        def align4():
            while (data_off + len(data)) % 4: data.append(0)

        # code items
        code_offs = {}
        for (m, acc, regs, ins, outs, fn) in direct + virtual:
            align4()
            code_offs[m] = here()
            insns = fn(ix)
            data += u16(regs) + u16(ins) + u16(outs) + u16(0) + u32(0) + u32(len(insns))
            for w in insns: data += u16(w)
        n_code = len(direct) + len(virtual)
        code_start = code_offs[(direct + virtual)[0][0]]

        # type lists (proto parameters)
        align4()
        tl_start = here(); tl_offs = {}
        for p in P:
            if p[2] and p[2] not in tl_offs:
                align4()
                tl_offs[p[2]] = here()
                data += u32(len(p[2])) + b''.join(u16(ti[q]) for q in p[2])
        n_tl = len(tl_offs)

        # string data
        sd_start = here(); sd_offs = []
        for x in S:
            sd_offs.append(here())
            data += uleb(len(x.encode('utf-16-le')) // 2) + x.encode('utf-8') + b'\0'

        # class data
        cd_off = here()
        cdata = uleb(0) + uleb(len(ifields)) + uleb(len(direct)) + uleb(len(virtual))
        prev = 0
        for (f, acc) in sorted(ifields, key=lambda e: fi[e[0]]):
            cdata += uleb(fi[f] - prev) + uleb(acc); prev = fi[f]
        for group in (direct, virtual):
            prev = 0
            for (m, acc, *_rest) in sorted(group, key=lambda e: mi[e[0]]):
                cdata += uleb(mi[m] - prev) + uleb(acc) + uleb(code_offs[m]); prev = mi[m]
        data += cdata

        # map list
        align4()
        map_off = here()
        items = [(0x0000, 1, 0), (0x0001, n_str, str_ids_off), (0x0002, n_typ, typ_ids_off),
                 (0x0003, n_pro, pro_ids_off), (0x0004, n_fld, fld_ids_off),
                 (0x0005, n_met, met_ids_off), (0x0006, 1, cls_defs_off),
                 (0x2001, n_code, code_start)]
        if n_tl: items.append((0x1001, n_tl, tl_start))
        items += [(0x2002, n_str, sd_start), (0x2000, 1, cd_off), (0x1000, 1, map_off)]
        items = [it for it in items if it[1]]
        items.sort(key=lambda it: it[2])
        data += u32(len(items)) + b''.join(u16(t) + u16(0) + u32(n) + u32(o) for t, n, o in items)
        align4()

        # id sections
        ids = bytearray()
        ids += b''.join(u32(o) for o in sd_offs)
        ids += b''.join(u32(si[d]) for d in T)
        for p in P:
            ids += u32(si[p[0]]) + u32(ti[p[1]]) + u32(tl_offs[p[2]] if p[2] else 0)
        for f in F:
            ids += u16(ti[f[0]]) + u16(ti[f[2]]) + u32(si[f[1]])
        for m in M:
            ids += u16(ti[m[0]]) + u16(pi[m[2]]) + u32(si[m[1]])
        ids += u32(ti[cls]) + u32(0x1) + u32(ti[super_cls]) + u32(0) + u32(NO_INDEX) \
            + u32(0) + u32(cd_off) + u32(0)
        assert 0x70 + len(ids) == data_off

        file_size = data_off + len(data)
        hdr = bytearray(b'dex\n035\0' + b'\0' * 24)
        hdr += u32(file_size) + u32(0x70) + u32(0x12345678) + u32(0) + u32(0) + u32(map_off)
        hdr += u32(n_str) + u32(str_ids_off) + u32(n_typ) + u32(typ_ids_off)
        hdr += u32(n_pro) + u32(pro_ids_off) + u32(n_fld) + u32(fld_ids_off)
        hdr += u32(n_met) + u32(met_ids_off) + u32(1) + u32(cls_defs_off)
        hdr += u32(len(data)) + u32(data_off)
        assert len(hdr) == 0x70
        out = bytearray(hdr + ids + data)
        out[12:32] = hashlib.sha1(out[32:]).digest()
        out[8:12] = u32(zlib.adler32(bytes(out[12:])))
        return bytes(out)


# Dalvik instruction encoders (return lists of 16-bit code units)
def invoke(opcode, midx, *regs):
    r = list(regs); n = len(r); r += [0] * (5 - n)
    return [(n << 12) | (r[4] << 8) | opcode, midx, (r[3] << 12) | (r[2] << 8) | (r[1] << 4) | r[0]]
INV_VIRTUAL, INV_SUPER, INV_DIRECT = 0x6e, 0x6f, 0x70
def return_void(): return [0x000e]
def new_instance(reg, tidx): return [(reg << 8) | 0x22, tidx]
def const4(reg, v): return [((v & 0xf) << 12) | (reg << 8) | 0x12]
def const16(reg, v): return [(reg << 8) | 0x13, v & 0xffff]
def const_string(reg, sidx): return [(reg << 8) | 0x1a, sidx]
def move_result(reg): return [(reg << 8) | 0x0a]
def move_result_object(reg): return [(reg << 8) | 0x0c]
def iget_object(dst, obj, fidx): return [(obj << 12) | (dst << 8) | 0x54, fidx]
def iput_object(src, obj, fidx): return [(obj << 12) | (src << 8) | 0x5b, fidx]
def if_eqz(reg, off): return [(reg << 8) | 0x38, off & 0xffff]


def build_dex(start_url):
    d = Dex()
    ACT = 'Landroid/app/Activity;'; ME = 'Lcom/kurdishtank/app/MainActivity;'
    WV = 'Landroid/webkit/WebView;'; WS = 'Landroid/webkit/WebSettings;'
    WVC = 'Landroid/webkit/WebViewClient;'; WCC = 'Landroid/webkit/WebChromeClient;'
    VIEW = 'Landroid/view/View;'; CTX = 'Landroid/content/Context;'
    BUNDLE = 'Landroid/os/Bundle;'; STR = 'Ljava/lang/String;'
    d.t(ME); d.t(ACT)
    url = d.s(start_url)
    f_wv = d.field(ME, 'wv', WV)
    act_init = d.method(ACT, '<init>', 'V')
    act_onCreate = d.method(ACT, 'onCreate', 'V', [BUNDLE])
    act_setContent = d.method(ACT, 'setContentView', 'V', [VIEW])
    act_back = d.method(ACT, 'onBackPressed', 'V')
    act_pause = d.method(ACT, 'onPause', 'V')
    act_resume = d.method(ACT, 'onResume', 'V')
    me_init = d.method(ME, '<init>', 'V')
    me_onCreate = d.method(ME, 'onCreate', 'V', [BUNDLE])
    me_back = d.method(ME, 'onBackPressed', 'V')
    me_pause = d.method(ME, 'onPause', 'V')
    me_resume = d.method(ME, 'onResume', 'V')
    wv_init = d.method(WV, '<init>', 'V', [CTX])
    wv_settings = d.method(WV, 'getSettings', WS)
    wv_setClient = d.method(WV, 'setWebViewClient', 'V', [WVC])
    wv_setChrome = d.method(WV, 'setWebChromeClient', 'V', [WCC])
    wv_load = d.method(WV, 'loadUrl', 'V', [STR])
    wv_canBack = d.method(WV, 'canGoBack', 'Z')
    wv_goBack = d.method(WV, 'goBack', 'V')
    wv_pause = d.method(WV, 'onPause', 'V')
    wv_resume = d.method(WV, 'onResume', 'V')
    ws_js = d.method(WS, 'setJavaScriptEnabled', 'V', ['Z'])
    ws_dom = d.method(WS, 'setDomStorageEnabled', 'V', ['Z'])
    ws_db = d.method(WS, 'setDatabaseEnabled', 'V', ['Z'])
    ws_media = d.method(WS, 'setMediaPlaybackRequiresUserGesture', 'V', ['Z'])
    wvc_init = d.method(WVC, '<init>', 'V')
    wcc_init = d.method(WCC, '<init>', 'V')
    v_keep = d.method(VIEW, 'setKeepScreenOn', 'V', ['Z'])
    v_sysui = d.method(VIEW, 'setSystemUiVisibility', 'V', ['I'])
    SYSUI = 0x1706  # immersive sticky + hide status and navigation bars

    def c_init(ix):
        m = ix['m']
        return invoke(INV_DIRECT, m[act_init], 0) + return_void()

    def c_onCreate(ix):   # v0..v3 locals, v4 = this, v5 = bundle
        m, t, f, s = ix['m'], ix['t'], ix['f'], ix['s']
        c = []
        c += invoke(INV_SUPER, m[act_onCreate], 4, 5)
        c += new_instance(0, t[WV])
        c += invoke(INV_DIRECT, m[wv_init], 0, 4)
        c += iput_object(0, 4, f[f_wv])
        c += invoke(INV_VIRTUAL, m[wv_settings], 0)
        c += move_result_object(1)
        c += const4(2, 1)
        c += invoke(INV_VIRTUAL, m[ws_js], 1, 2)
        c += invoke(INV_VIRTUAL, m[ws_dom], 1, 2)
        c += invoke(INV_VIRTUAL, m[ws_db], 1, 2)
        c += const4(3, 0)
        c += invoke(INV_VIRTUAL, m[ws_media], 1, 3)
        c += new_instance(1, t[WVC])
        c += invoke(INV_DIRECT, m[wvc_init], 1)
        c += invoke(INV_VIRTUAL, m[wv_setClient], 0, 1)
        c += new_instance(1, t[WCC])
        c += invoke(INV_DIRECT, m[wcc_init], 1)
        c += invoke(INV_VIRTUAL, m[wv_setChrome], 0, 1)
        c += invoke(INV_VIRTUAL, m[v_keep], 0, 2)
        c += const16(1, SYSUI)
        c += invoke(INV_VIRTUAL, m[v_sysui], 0, 1)
        c += const_string(1, s[url])
        c += invoke(INV_VIRTUAL, m[wv_load], 0, 1)
        c += invoke(INV_VIRTUAL, m[act_setContent], 4, 0)
        c += return_void()
        return c

    def c_back(ix):   # v0, v1 locals, v2 = this
        m, f = ix['m'], ix['f']
        head = iget_object(0, 2, f[f_wv])                 # 2 units
        call = invoke(INV_VIRTUAL, m[wv_canBack], 0) + move_result(1)   # 3 + 1
        # layout: head(2) if1(2) call(4) if2(2) goBack(3) ret(1) | sup: super(3) ret(1)
        goback = invoke(INV_VIRTUAL, m[wv_goBack], 0) + return_void()
        sup = invoke(INV_SUPER, m[act_back], 2) + return_void()
        pos_if1 = len(head)
        pos_if2 = pos_if1 + 2 + len(call)
        pos_sup = pos_if2 + 2 + len(goback)
        c = head + if_eqz(0, pos_sup - pos_if1) + call + if_eqz(1, pos_sup - pos_if2) + goback + sup
        assert len(c) == pos_sup + len(sup)
        return c

    def c_pause(ix):   # v0 local, v1 = this
        m, f = ix['m'], ix['f']
        c = invoke(INV_SUPER, m[act_pause], 1) + iget_object(0, 1, f[f_wv])
        tail = invoke(INV_VIRTUAL, m[wv_pause], 0)
        return c + if_eqz(0, 2 + len(tail)) + tail + return_void()

    def c_resume(ix):  # v0, v1 locals, v2 = this
        m, f = ix['m'], ix['f']
        c = invoke(INV_SUPER, m[act_resume], 2) + iget_object(0, 2, f[f_wv])
        tail = invoke(INV_VIRTUAL, m[wv_resume], 0) + const16(1, SYSUI) \
            + invoke(INV_VIRTUAL, m[v_sysui], 0, 1)
        return c + if_eqz(0, 2 + len(tail)) + tail + return_void()

    PUB, PRIV, CTOR = 0x1, 0x2, 0x10000
    return d.build(ME, ACT, [(f_wv, PRIV)],
                   [(me_init, PUB | CTOR, 1, 1, 1, c_init)],
                   [(me_onCreate, PUB, 6, 2, 2, c_onCreate),
                    (me_back, PUB, 3, 1, 1, c_back),
                    (me_pause, PUB, 2, 1, 1, c_pause),
                    (me_resume, PUB, 3, 1, 2, c_resume)])


# ================================================================ string pools
def string_pool(strings):
    """ResStringPool chunk, UTF-16."""
    offs, body = [], bytearray()
    for x in strings:
        offs.append(len(body))
        enc = x.encode('utf-16-le'); n = len(enc) // 2
        assert n < 0x8000
        body += u16(n) + enc + b'\0\0'
    body = pad4(bytes(body))
    hsize = 28
    strings_start = hsize + 4 * len(strings)
    size = strings_start + len(body)
    return u16(0x0001) + u16(hsize) + u32(size) + u32(len(strings)) + u32(0) + u32(0) \
        + u32(strings_start) + u32(0) + b''.join(u32(o) for o in offs) + body


# ================================================================ binary XML
ANDROID_NS = 'http://schemas.android.com/apk/res/android'
ATTR = {
    'theme': 0x01010000, 'label': 0x01010001, 'icon': 0x01010002, 'name': 0x01010003,
    'exported': 0x01010010, 'screenOrientation': 0x0101001e, 'configChanges': 0x0101001f,
    'minSdkVersion': 0x0101020c, 'versionCode': 0x0101021b, 'versionName': 0x0101021c,
    'targetSdkVersion': 0x01010270, 'hardwareAccelerated': 0x010102d3, 'required': 0x0101028e,
}
T_REF, T_STRING, T_INT_DEC, T_INT_HEX, T_BOOL = 0x01, 0x03, 0x10, 0x11, 0x12

def axml(tree):
    """tree = (tag, [(name, type, value)], [children]); attrs use android: ns except 'package'."""
    # collect strings: attribute names with resource ids first (in id order)
    attr_names, other = [], []
    def walk(node):
        tag, attrs, kids = node
        other.append(tag)
        for (n, typ, v) in attrs:
            if n in ATTR:
                if n not in attr_names: attr_names.append(n)
            else: other.append(n)
            if typ == T_STRING: other.append(v)
        for k in kids: walk(k)
    walk(tree)
    attr_names.sort(key=lambda n: ATTR[n])
    strings = list(attr_names)
    for x in ['android', ANDROID_NS] + other:
        if x not in strings: strings.append(x)
    si = {x: i for i, x in enumerate(strings)}

    chunks = [string_pool(strings)]
    rmap = b''.join(u32(ATTR[n]) for n in attr_names)
    chunks.append(u16(0x0180) + u16(8) + u32(8 + len(rmap)) + rmap)
    ns = u32(si['android']) + u32(si[ANDROID_NS])
    chunks.append(u16(0x0100) + u16(16) + u32(24) + u32(1) + u32(NO_INDEX) + ns)

    line = [1]
    def emit(node):
        tag, attrs, kids = node
        line[0] += 1
        attrs = sorted(attrs, key=lambda a: ATTR.get(a[0], 0))
        ab = bytearray()
        for (n, typ, v) in attrs:
            nsidx = si[ANDROID_NS] if n in ATTR else NO_INDEX
            if typ == T_STRING: raw, data = si[v], si[v]
            else: raw, data = NO_INDEX, v
            ab += u32(nsidx) + u32(si[n]) + u32(raw) + u16(8) + u8(0) + u8(typ) + u32(data)
        body = u32(NO_INDEX) + u32(si[tag]) + u16(20) + u16(20) + u16(len(attrs)) + u16(0) + u16(0) + u16(0) + ab
        chunks.append(u16(0x0102) + u16(16) + u32(16 + len(body)) + u32(line[0]) + u32(NO_INDEX) + body)
        for k in kids: emit(k)
        line[0] += 1
        chunks.append(u16(0x0103) + u16(16) + u32(24) + u32(line[0]) + u32(NO_INDEX) + u32(NO_INDEX) + u32(si[tag]))
    emit(tree)
    chunks.append(u16(0x0101) + u16(16) + u32(24) + u32(line[0] + 1) + u32(NO_INDEX) + ns)
    body = b''.join(chunks)
    return u16(0x0003) + u16(8) + u32(8 + len(body)) + body


def manifest(package, label, version_code, version_name):
    A = lambda n, t, v: (n, t, v)
    return axml(('manifest', [
            A('versionCode', T_INT_DEC, version_code), A('versionName', T_STRING, version_name),
            ('package', T_STRING, package)], [
        ('uses-sdk', [A('minSdkVersion', T_INT_DEC, 24), A('targetSdkVersion', T_INT_DEC, 34)], []),
        ('uses-permission', [A('name', T_STRING, 'android.permission.INTERNET')], []),
        ('uses-permission', [A('name', T_STRING, 'android.permission.ACCESS_NETWORK_STATE')], []),
        # Voice chat. The simple WebView build cannot hand the microphone to the page yet
        # (that needs a WebChromeClient subclass); the Capacitor build will.
        ('uses-permission', [A('name', T_STRING, 'android.permission.RECORD_AUDIO')], []),
        ('uses-permission', [A('name', T_STRING, 'android.permission.MODIFY_AUDIO_SETTINGS')], []),
        ('uses-feature', [A('name', T_STRING, 'android.hardware.microphone'), A('required', T_BOOL, 0)], []),
        ('application', [
            A('theme', T_REF, 0x0103000a),          # @android:style/Theme.Black.NoTitleBar.Fullscreen
            A('label', T_STRING, label), A('icon', T_REF, 0x7f010000),
            A('hardwareAccelerated', T_BOOL, 0xffffffff)], [
            ('activity', [
                A('name', T_STRING, package + '.MainActivity'),
                A('exported', T_BOOL, 0xffffffff),
                A('screenOrientation', T_INT_DEC, 6),   # sensorLandscape
                A('configChanges', T_INT_HEX, 0x0fb0),
                A('hardwareAccelerated', T_BOOL, 0xffffffff)], [
                ('intent-filter', [], [
                    ('action', [A('name', T_STRING, 'android.intent.action.MAIN')], []),
                    ('category', [A('name', T_STRING, 'android.intent.category.LAUNCHER')], []),
                ]),
            ]),
        ]),
    ]))


# ================================================================ resources.arsc
def resources_arsc(package, icon_path):
    """One resource: mipmap/ic_launcher (0x7f010000) -> icon_path at xxxhdpi."""
    values = string_pool([icon_path])
    type_strings = string_pool(['mipmap'])
    key_strings = string_pool(['ic_launcher'])
    spec = u16(0x0202) + u16(16) + u32(16 + 4) + u8(1) + u8(0) + u16(0) + u32(1) + u32(0)
    config = bytearray(64); config[0:4] = u32(64); config[14:16] = u16(640)  # density xxxhdpi
    entry = u16(8) + u16(0) + u32(0) + u16(8) + u8(0) + u8(T_STRING) + u32(0)
    hsize = 20 + 64
    typ = u16(0x0201) + u16(hsize) + u32(hsize + 4 + len(entry)) + u8(1) + u8(0) + u16(0) \
        + u32(1) + u32(hsize + 4) + bytes(config) + u32(0) + entry
    name = package.encode('utf-16-le')[:254]
    name += b'\0' * (256 - len(name))
    ph = 288
    pkg_body = type_strings + key_strings + spec + typ
    pkg = u16(0x0200) + u16(ph) + u32(ph + len(pkg_body)) + u32(0x7f) + name \
        + u32(ph) + u32(1) + u32(ph + len(type_strings)) + u32(1) + u32(0) + pkg_body
    body = values + pkg
    return u16(0x0002) + u16(12) + u32(12 + len(body)) + u32(1) + body


# ================================================================ start page
START_HTML = r'''<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>
html,body{margin:0;height:100%;background:#101315;color:#e8e4d8;font-family:system-ui,sans-serif}
body{display:flex;align-items:center;justify-content:center;text-align:center}
.box{padding:24px;max-width:520px}
img{width:96px;height:96px;border-radius:22px;box-shadow:0 6px 24px #0008}
h1{font-size:26px;margin:14px 0 6px;letter-spacing:.5px}
p{margin:6px 0;opacity:.85;font-size:15px}
.sp{width:34px;height:34px;margin:16px auto;border:4px solid #ffffff22;border-top-color:#e8b64a;border-radius:50%;animation:r 1s linear infinite}
@keyframes r{to{transform:rotate(360deg)}}
button{margin:14px 6px 0;padding:12px 22px;font-size:16px;border:0;border-radius:12px;background:#e8b64a;color:#1a1a1a;font-weight:700}
button.alt{background:#2a3136;color:#e8e4d8}
.hide{display:none}
input{margin-top:14px;width:100%;box-sizing:border-box;padding:12px;font-size:16px;border-radius:10px;border:1px solid #3a4248;background:#1b2024;color:#e8e4d8;direction:ltr}
</style></head><body><div class="box">
<img src="icon.png" alt="">
<h1>Kurdish Tank</h1>
<div id="wait"><div class="sp"></div><p id="msg">Connecting… · پەیوەندی دەکرێت…</p><p id="slow" class="hide">The server is waking up, this can take up to a minute.<br>سێرڤەرەکە هەڵدەستێت، لەوانەیە خولەکێک بخایەنێت.</p></div>
<div id="err" class="hide"><p id="emsg"></p><button id="retry">Try again · دووبارە</button><button id="anyway" class="alt">Open anyway</button><br><button id="chg" class="alt">Change server · گۆڕینی سێرڤەر</button>
<div id="set" class="hide"><input id="addr" type="url" placeholder="https://….onrender.com/" autocapitalize="off" autocorrect="off" spellcheck="false"><br><button id="save">Save · پاشەکەوت</button></div></div>
</div>
<script>
var DEFAULT_URL = '__SERVER_URL__', URL_ = DEFAULT_URL;
try { var saved = localStorage.getItem('kt_server'); if (saved) URL_ = saved; } catch (e) {}
function clean(u) {
  u = (u || '').trim(); if (!u) return DEFAULT_URL;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u.replace(/[?#].*$/, '').replace(/\/*$/, '/');
}
var $ = function (id) { return document.getElementById(id); };
function fail(t) { $('wait').className = 'hide'; $('err').className = ''; $('emsg').innerHTML = t; }
function open_() { location.replace(URL_); }
function go() {
  $('err').className = 'hide'; $('wait').className = ''; $('slow').className = 'hide';
  if (navigator.onLine === false) { fail('No internet connection.<br>ئینتەرنێت نییە.'); return; }
  var done = false;
  var slow = setTimeout(function () { $('slow').className = ''; }, 5000);
  var t = setTimeout(function () { if (!done) { done = true; clearTimeout(slow); fail('Could not reach the game server.<br>نەتوانرا پەیوەندی بە سێرڤەرەوە بکرێت.'); } }, 90000);
  // Probe with an image: works from a local page and waits while Render wakes up.
  var img = new Image();
  img.onload = function () { if (done) return; done = true; clearTimeout(t); clearTimeout(slow); open_(); };
  img.onerror = function () {
    if (done) return; done = true; clearTimeout(t); clearTimeout(slow);
    fail('Could not reach the game server.<br>نەتوانرا پەیوەندی بە سێرڤەرەوە بکرێت.');
  };
  img.src = URL_ + 'icons/icon-192.png?t=' + Date.now();
}
$('retry').onclick = go; $('anyway').onclick = open_;
$('chg').onclick = function () { $('set').className = ''; $('addr').value = URL_; $('addr').focus(); };
$('save').onclick = function () {
  URL_ = clean($('addr').value);
  try { if (URL_ === DEFAULT_URL) localStorage.removeItem('kt_server'); else localStorage.setItem('kt_server', URL_); } catch (e) {}
  $('set').className = 'hide'; go();
};
go();
</script></body></html>
'''


# ================================================================ signing (APK Signature Scheme v2)
def load_or_make_key(path):
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    if os.path.exists(path):
        data = open(path, 'rb').read()
        key = serialization.load_pem_private_key(data, None)
        cert = x509.load_pem_x509_certificate(data[data.index(b'-----BEGIN CERTIFICATE'):])
        return key, cert
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Kurdish Tank'),
                      x509.NameAttribute(NameOID.ORGANIZATION_NAME, 'Kurdish Tank')])
    now = datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now).not_valid_after(now + datetime.timedelta(days=365 * 40))
            .sign(key, hashes.SHA256()))
    with open(path, 'wb') as fh:
        fh.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                   serialization.NoEncryption()))
        fh.write(cert.public_bytes(serialization.Encoding.PEM))
    return key, cert

def lp(b): return u32(len(b)) + b

def chunk_digest(parts):
    digs = []
    for part in parts:
        for i in range(0, len(part), 1 << 20):
            c = part[i:i + (1 << 20)]
            digs.append(hashlib.sha256(b'\xa5' + u32(len(c)) + c).digest())
    return hashlib.sha256(b'\x5a' + u32(len(digs)) + b''.join(digs)).digest()

def sign_v2(apk, key, cert):
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    eocd = apk.rindex(b'PK\x05\x06')
    cd_off = struct.unpack('<I', apk[eocd + 16:eocd + 20])[0]
    before, cd, end = apk[:cd_off], apk[cd_off:eocd], apk[eocd:]
    ALG = 0x0103  # RSASSA-PKCS1-v1_5 with SHA2-256
    digest = chunk_digest([before, cd, end])   # EOCD cd offset == block start (unchanged)
    cert_der = cert.public_bytes(serialization.Encoding.DER)
    signed = lp(lp(u32(ALG) + lp(digest))) + lp(lp(cert_der)) + lp(b'')
    sig = key.sign(signed, padding.PKCS1v15(), hashes.SHA256())
    pub = key.public_key().public_bytes(serialization.Encoding.DER,
                                        serialization.PublicFormat.SubjectPublicKeyInfo)
    signer = lp(signed) + lp(lp(u32(ALG) + lp(sig))) + lp(pub)
    value = lp(lp(signer))
    pair = u64(4 + len(value)) + u32(0x7109871a) + value
    size = len(pair) + 8 + 16
    block = u64(size) + pair + u64(size) + b'APK Sig Block 42'
    new_end = bytearray(end); new_end[16:20] = u32(cd_off + len(block))
    return before + block + cd + bytes(new_end)


# ================================================================ zip
def write_zip(entries):
    """entries: [(name, bytes, store)] ; stored entries are 4-byte aligned."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        for name, data, store in entries:
            zi = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            zi.create_system = 0
            if store:
                zi.compress_type = zipfile.ZIP_STORED
                pos = buf.tell() + 30 + len(name.encode())
                need = (-(pos + 6)) % 4
                zi.extra = u16(0xd935) + u16(2 + need) + u16(4) + b'\0' * need
            else:
                zi.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(zi, data)
    return buf.getvalue()


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(os.path.join(here, '..', '..'))
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='https://trackfire1-7.onrender.com/')
    ap.add_argument('--out', default=os.path.join(root, 'kurdish-tank.apk'))
    ap.add_argument('--key', default=os.path.join(here, 'release-key.pem'))
    ap.add_argument('--package', default='com.kurdishtank.app')
    ap.add_argument('--label', default='Kurdish Tank')
    ap.add_argument('--version-code', type=int, default=14)
    ap.add_argument('--version-name', default='2.3')
    a = ap.parse_args()
    url = a.url if a.url.endswith('/') else a.url + '/'

    icon = open(os.path.join(root, 'client', 'icons', 'icon-192.png'), 'rb').read()
    icon_res = 'res/mipmap-xxxhdpi/ic_launcher.png'
    entries = [
        ('AndroidManifest.xml', manifest(a.package, a.label, a.version_code, a.version_name), False),
        ('classes.dex', build_dex('file:///android_asset/start.html'), False),
        ('resources.arsc', resources_arsc(a.package, icon_res), True),
        (icon_res, icon, True),
        ('assets/start.html', START_HTML.replace('__SERVER_URL__', url).encode('utf-8'), False),
        ('assets/icon.png', icon, True),
    ]
    key, cert = load_or_make_key(a.key)
    apk = sign_v2(write_zip(entries), key, cert)
    with open(a.out, 'wb') as fh: fh.write(apk)
    print('wrote', a.out, len(apk), 'bytes; server', url)


if __name__ == '__main__':
    main()
