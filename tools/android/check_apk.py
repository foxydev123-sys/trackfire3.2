#!/usr/bin/env python3
"""Independent checks for the hand-built APK: dex structure + disassembly,
binary manifest dump, resources.arsc dump, zip alignment and v2 signature."""
import hashlib, struct, sys, zipfile, zlib, io

def U(fmt, b, o): return struct.unpack_from('<' + fmt, b, o)

def uleb(b, o):
    r = s = 0
    while True:
        x = b[o]; o += 1; r |= (x & 0x7f) << s; s += 7
        if not x & 0x80: return r, o

def check_dex(b):
    assert b[:8] == b'dex\n035\0'
    assert U('I', b, 8)[0] == zlib.adler32(b[12:]), 'checksum'
    assert b[12:32] == hashlib.sha1(b[32:]).digest(), 'sha1'
    (fsize, hsize, endian, _, _, map_off, ns, so, nt, to, np_, po, nf, fo, nm, mo, nc, co, dsize, doff) = U('20I', b, 32)
    assert fsize == len(b) and hsize == 0x70 and endian == 0x12345678
    assert dsize % 4 == 0 and doff + dsize == len(b), (dsize, doff, len(b))
    S = []
    for i in range(ns):
        off = U('I', b, so + 4 * i)[0]; n, o = uleb(b, off)
        e = b.index(b'\0', o); S.append(b[o:e].decode()); assert len(S[-1]) == n
    assert S == sorted(S), 'strings sorted'
    T = [S[U('I', b, to + 4 * i)[0]] for i in range(nt)]
    tidx = [U('I', b, to + 4 * i)[0] for i in range(nt)]
    assert tidx == sorted(tidx) and len(set(tidx)) == nt
    def tl(off):
        if not off: return []
        n = U('I', b, off)[0]; assert off % 4 == 0
        return [U('H', b, off + 4 + 2 * i)[0] for i in range(n)]
    P = []
    for i in range(np_):
        sh, rt, pl = U('3I', b, po + 12 * i); P.append((S[sh], rt, tl(pl)))
        params = ''.join('L' if T[x][0] in 'L[' else T[x] for x in P[-1][2])
        assert S[sh] == ('L' if T[rt][0] in 'L[' else T[rt]) + params, 'shorty'
    assert [(p[1], p[2]) for p in P] == sorted((p[1], p[2]) for p in P)
    F = [U('HHI', b, fo + 8 * i) for i in range(nf)]
    assert [(c, n, t) for c, t, n in F] == sorted((c, n, t) for c, t, n in F)
    M = [U('HHI', b, mo + 8 * i) for i in range(nm)]
    assert [(c, n, p) for c, p, n in M] == sorted((c, n, p) for c, p, n in M)
    assert len(set(M)) == nm
    def mname(i):
        c, p, n = M[i]; pr = P[p]
        return f"{T[c]}->{S[n]}({''.join(T[x] for x in pr[2])}){T[pr[1]]}"
    def fname(i):
        c, t, n = F[i]; return f"{T[c]}->{S[n]}:{T[t]}"
    # map list
    n = U('I', b, map_off)[0]; items = [U('HHII', b, map_off + 4 + 12 * i) for i in range(n)]
    offs = [it[3] for it in items]; assert offs == sorted(offs), 'map sorted'
    types = {it[0]: it for it in items}
    for k in (0, 1, 2, 3, 5, 6, 0x1000, 0x2000, 0x2001, 0x2002): assert k in types, hex(k)
    # class
    assert nc == 1
    cls, acc, sup, ifs, src, ann, cdo, sv = U('8I', b, co)
    print('class', T[cls], 'extends', T[sup], 'flags', hex(acc))
    o = cdo
    sf, o = uleb(b, o); inf, o = uleb(b, o); dm, o = uleb(b, o); vm, o = uleb(b, o)
    fi = 0
    for _ in range(sf + inf):
        d, o = uleb(b, o); a, o = uleb(b, o); fi += d; print('  field', fname(fi), hex(a))
    for group, cnt in (('direct', dm), ('virtual', vm)):
        mi = 0
        for _ in range(cnt):
            d, o = uleb(b, o); a, o = uleb(b, o); code, o = uleb(b, o); mi += d
            regs, ins, outs, tries, dbg, isz = U('4H2I', b, code)
            assert code % 4 == 0 and tries == 0
            print(f'  {group} {mname(mi)} flags={hex(a)} regs={regs} ins={ins} outs={outs}')
            ws = [U('H', b, code + 16 + 2 * i)[0] for i in range(isz)]
            disasm(ws, regs, ins, outs, S, T, mname, fname)

def disasm(ws, regs, ins, outs, S, T, mname, fname):
    i = 0; maxout = 0
    def R(r): assert r < regs, f'reg v{r} >= {regs}'; return f'v{r}'
    while i < len(ws):
        w = ws[i]; op = w & 0xff; A = w >> 8
        if op == 0x0e: txt, n = 'return-void', 1
        elif op in (0x6e, 0x6f, 0x70):
            cnt = w >> 12; g = (w >> 8) & 0xf; m = ws[i + 1]; w2 = ws[i + 2]
            rr = [w2 & 0xf, (w2 >> 4) & 0xf, (w2 >> 8) & 0xf, w2 >> 12, g][:cnt]
            maxout = max(maxout, cnt)
            txt = {0x6e: 'invoke-virtual', 0x6f: 'invoke-super', 0x70: 'invoke-direct'}[op] + \
                ' {' + ','.join(R(r) for r in rr) + '} ' + mname(m); n = 3
            # argument count must match the proto (+this)
            sig = mname(m); params = sig[sig.index('(') + 1:sig.index(')')]
            k = 0; j = 0
            while j < len(params):
                if params[j] == 'L': j = params.index(';', j) + 1
                else: j += 1
                k += 1
            assert cnt == k + 1, ('arg count', sig, cnt)
        elif op == 0x22: txt, n = f'new-instance {R(A)}, {T[ws[i+1]]}', 2
        elif op == 0x12: txt, n = f'const/4 {R(A & 0xf)}, {w >> 12}', 1
        elif op == 0x13: txt, n = f'const/16 {R(A)}, {hex(ws[i+1])}', 2
        elif op == 0x1a: txt, n = f'const-string {R(A)}, "{S[ws[i+1]]}"', 2
        elif op == 0x0a: txt, n = f'move-result {R(A)}', 1
        elif op == 0x0c: txt, n = f'move-result-object {R(A)}', 1
        elif op == 0x54: txt, n = f'iget-object {R(A & 0xf)}, {R(w >> 12)}, {fname(ws[i+1])}', 2
        elif op == 0x5b: txt, n = f'iput-object {R(A & 0xf)}, {R(w >> 12)}, {fname(ws[i+1])}', 2
        elif op == 0x38:
            off = ws[i + 1]; off -= 0x10000 if off & 0x8000 else 0
            assert 0 < i + off < len(ws); txt, n = f'if-eqz {R(A)}, +{off} (-> {i+off})', 2
        else: raise AssertionError('unknown op ' + hex(op))
        print(f'      {i:3}: {txt}'); i += n
    assert i == len(ws) and ws[-1] == 0x0e
    assert maxout == outs, ('outs', maxout, outs)

def pool(b, o):
    t, hs, size, cnt, scnt, flags, ss, sts = U('HHIIIIII', b, o)
    assert t == 1
    out = []
    for i in range(cnt):
        so = o + ss + U('I', b, o + hs + 4 * i)[0]
        if flags & 0x100:
            n = b[so]; so += 2; out.append(b[so:so + n].decode())
        else:
            n = U('H', b, so)[0]; out.append(b[so + 2:so + 2 + 2 * n].decode('utf-16-le'))
    return out, size

def dump_axml(b):
    t, hs, size = U('HHI', b, 0); assert t == 3 and size == len(b)
    o = 8; S, sz = pool(b, o); o += sz
    ids = []
    depth = 0
    while o < len(b):
        t, hs, size = U('HHI', b, o)
        if t == 0x180: ids = [U('I', b, o + 8 + 4 * i)[0] for i in range((size - 8) // 4)]
        elif t == 0x102:
            ns, name, ast, asz, acnt = U('IIHHH', b, o + 16)
            attrs = []
            for i in range(acnt):
                ans, an, raw, vs, r0, typ, data = U('IIIHBBI', b, o + 16 + ast + 20 * i)
                rid = ids[an] if an < len(ids) else None
                v = S[data] if typ == 3 else hex(data)
                attrs.append(f'{"android:" if ans != 0xffffffff else ""}{S[an]}{"["+hex(rid)+"]" if rid else ""}={v}')
            print('  ' * depth + '<' + S[name] + ' ' + ' '.join(attrs) + '>'); depth += 1
        elif t == 0x103: depth -= 1
        o += size
    assert depth == 0

def dump_arsc(b):
    t, hs, size, npk = U('HHII', b, 0); assert t == 2 and size == len(b) and npk == 1
    vals, sz = pool(b, 12); print('  values', vals)
    po = 12 + sz; t, hs, size, pid = U('HHII', b, po); assert t == 0x200 and po + size == len(b)
    tso, lpt, kso = U('III', b, po + 12 + 256)
    types, _ = pool(b, po + tso); keys, _ = pool(b, po + kso)
    print('  package', hex(pid), 'types', types, 'keys', keys)
    o = po + hs
    while o < po + size:
        t, h, sz = U('HHI', b, o)
        if t == 0x201:
            tid, fl, res, cnt, est = U('BBHII', b, o + 8)
            dens = U('H', b, o + 20 + 14)[0]
            eo = U('I', b, o + h)[0]
            es, ef, key = U('HHI', b, o + est + eo); vs, r0, typ, data = U('HBBI', b, o + est + eo + 8)
            print(f'  res 0x7f{tid:02x}0000 {types[tid-1]}/{keys[key]} density={dens} -> {vals[data]}')
        o += sz

def check_sig(apk):
    eocd = apk.rindex(b'PK\x05\x06'); cd = U('I', apk, eocd + 16)[0]
    assert apk[cd - 16:cd] == b'APK Sig Block 42'
    size = U('Q', apk, cd - 24)[0]; start = cd - size - 8
    assert U('Q', apk, start)[0] == size
    o = start + 8
    ln, id_ = U('QI', apk, o); assert id_ == 0x7109871a
    v = apk[o + 12:o + 8 + ln]
    def lp(b, o): n = U('I', b, o)[0]; return b[o + 4:o + 4 + n], o + 4 + n
    signers, _ = lp(v, 0); signer, _ = lp(signers, 0)
    signed, p = lp(signer, 0); sigs, p = lp(signer, p); pub, p = lp(signer, p)
    digs, q = lp(signed, 0); d0, _ = lp(digs, 0); alg = U('I', d0, 0)[0]; dig, _ = lp(d0, 4)
    sig0, _ = lp(sigs, 0); salg = U('I', sig0, 0)[0]; sig, _ = lp(sig0, 4)
    from cryptography.hazmat.primitives.serialization import load_der_public_key
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding
    load_der_public_key(pub).verify(sig, signed, padding.PKCS1v15(), hashes.SHA256())
    end = bytearray(apk[eocd:]); end[16:20] = struct.pack('<I', start)
    parts = [apk[:start], apk[cd:eocd], bytes(end)]
    ds = []
    for part in parts:
        for i in range(0, len(part), 1 << 20):
            c = part[i:i + (1 << 20)]; ds.append(hashlib.sha256(b'\xa5' + struct.pack('<I', len(c)) + c).digest())
    top = hashlib.sha256(b'\x5a' + struct.pack('<I', len(ds)) + b''.join(ds)).digest()
    assert alg == salg == 0x0103 and top == dig, 'digest mismatch'
    print('v2 signature OK')

def main(path):
    apk = open(path, 'rb').read()
    z = zipfile.ZipFile(io.BytesIO(apk)); assert z.testzip() is None
    for zi in z.infolist():
        if zi.compress_type == zipfile.ZIP_STORED:
            n, e = U('HH', apk, zi.header_offset + 26)
            data_off = zi.header_offset + 30 + n + e
            assert data_off % 4 == 0, ('unaligned', zi.filename)
    print('zip OK, stored entries 4-byte aligned')
    print('--- classes.dex'); check_dex(z.read('classes.dex'))
    print('--- AndroidManifest.xml'); dump_axml(z.read('AndroidManifest.xml'))
    print('--- resources.arsc'); dump_arsc(z.read('resources.arsc'))
    assert 'res/mipmap-xxxhdpi/ic_launcher.png' in z.namelist()
    check_sig(apk)

main(sys.argv[1])
