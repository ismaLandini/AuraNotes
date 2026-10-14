"""Builds build/icon.icns from build/icon-1024.png (PNG-based icns, no macOS tools needed)."""
import io, struct, sys
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
src = Image.open(root / 'build' / 'icon-1024.png').convert('RGBA')
# (type, pixel size) pairs understood by modern macOS
entries = [(b'icp4', 16), (b'icp5', 32), (b'icp6', 64), (b'ic07', 128), (b'ic08', 256), (b'ic09', 512), (b'ic10', 1024),
           (b'ic11', 32), (b'ic12', 64), (b'ic13', 256), (b'ic14', 512)]
chunks = b''
for kind, size in entries:
    buf = io.BytesIO()
    src.resize((size, size), Image.LANCZOS).save(buf, 'PNG')
    data = buf.getvalue()
    chunks += kind + struct.pack('>I', len(data) + 8) + data
out = root / 'build' / 'icon.icns'
out.write_bytes(b'icns' + struct.pack('>I', len(chunks) + 8) + chunks)
print(out, out.stat().st_size)
