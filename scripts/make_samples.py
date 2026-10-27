"""Generate SYNTHETIC shelf and delivery photos plus ground-truth sidecars.

Each image gets a <name>.truth.json with the boxes SAM would return and the
label text a vision model should read. The mock provider replays these so the
whole pipeline runs offline; the Meta provider ignores them.
Fictional products only. Requires Pillow.
"""
import json, os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "..", "samples")
os.makedirs(OUT, exist_ok=True)
try:
    FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 15)
    SMALL = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 12)
except OSError:
    FONT = SMALL = ImageFont.load_default()

COLORS = ["#d9534f", "#5bc0de", "#5cb85c", "#f0ad4e", "#9b59b6", "#34495e", "#1abc9c", "#e67e22"]

def pack(draw, x, y, w, h, color, lines):
    draw.rectangle([x, y, x + w, y + h], fill=color, outline="#222", width=2)
    draw.rectangle([x + 6, y + 6, x + w - 6, y + h - 6], fill="white")
    ty = y + 12
    for i, t in enumerate(lines):
        draw.text((x + 12, ty), t, fill="black", font=FONT if i == 0 else SMALL)
        ty += 20 if i == 0 else 16

def render(name, title, packs, size=(1000, 640), bg="#c8b89a"):
    img = Image.new("RGB", size, bg)
    d = ImageDraw.Draw(img)
    d.text((16, 10), title + "  (SYNTHETIC DEMO IMAGE)", fill="black", font=FONT)
    regions = []
    for i, p in enumerate(packs):
        x, y, w, h = p["box"]
        lines = [p["name"], p["strength"] + "  x" + str(p["pack_size"]), "LOT " + p["lot"], "EXP " + p["expiry_label"]]
        pack(d, x, y, w, h, COLORS[i % len(COLORS)], lines)
        regions.append({
            "box": {"x1": x, "y1": y, "x2": x + w, "y2": y + h},
            "score": p.get("score", 0.95),
            "reading": {
                "name": p["name"], "strength": p["strength"], "pack_size": p["pack_size"],
                "lot": p["lot"], "expiry": p["expiry_label"], "confidence": p.get("confidence", 0.93)
            }
        })
    img.save(os.path.join(OUT, name + ".png"))
    with open(os.path.join(OUT, name + ".truth.json"), "w") as f:
        json.dump({"image": name + ".png", "synthetic": True, "regions": regions}, f, indent=2)

def grid(items, cols=4, x0=30, y0=50, w=220, h=120, gx=20, gy=20):
    out = []
    for i, it in enumerate(items):
        r, c = divmod(i, cols)
        out.append({**it, "box": (x0 + c * (w + gx), y0 + r * (h + gy), w, h)})
    return out

# Shelf photo: what is physically on the shelf right now.
shelf = grid([
    {"name": "Paracetamol", "strength": "500 mg", "pack_size": 20, "lot": "NL2405A", "expiry_label": "09/2027"},
    {"name": "Paracetamol", "strength": "500 mg", "pack_size": 20, "lot": "NL2311C", "expiry_label": "12/2026"},
    {"name": "Amoxicillin", "strength": "500 mg", "pack_size": 16, "lot": "OP2309K", "expiry_label": "10/2026"},
    {"name": "Omeprazole", "strength": "20 mg", "pack_size": 14, "lot": "DG2308F", "expiry_label": "09/2026"},
    {"name": "Cetirizine", "strength": "10 mg", "pack_size": 10, "lot": "OP2401D", "expiry_label": "01/2028"},
    {"name": "Ibuprofen", "strength": "400 mg", "pack_size": 24, "lot": "NL2402B", "expiry_label": "03/2027"},
    {"name": "Loratadine", "strength": "10 mg", "pack_size": 10, "lot": "OP2405L", "expiry_label": "08/2027"},
    {"name": "Metformin", "strength": "500 mg", "pack_size": 30, "lot": "DG2403H", "expiry_label": "11/2027"},
    # A blurry/partly hidden pack: low confidence, must go to human review.
    {"name": "Omeprazo?", "strength": "20 mg", "pack_size": 14, "lot": "DG24??G", "expiry_label": "06/2027", "confidence": 0.41},
])
render("shelf-01", "Shelf B2", shelf)

# Delivery photo: an incoming carton opened on the counter.
delivery = grid([
    {"name": "Ibuprofen", "strength": "400 mg", "pack_size": 24, "lot": "NL2409T", "expiry_label": "08/2028"},
    {"name": "Ibuprofen", "strength": "400 mg", "pack_size": 24, "lot": "NL2409T", "expiry_label": "08/2028"},
    {"name": "Oral rehydration salts", "strength": "sachet", "pack_size": 10, "lot": "NL2408S", "expiry_label": "05/2028"},
    {"name": "Amoxicillin", "strength": "500 mg", "pack_size": 16, "lot": "OP2408N", "expiry_label": "11/2026"},
], cols=4, y0=60)
render("delivery-01", "Delivery carton #1", delivery, size=(1000, 260))
print("wrote samples to", os.path.abspath(OUT))
