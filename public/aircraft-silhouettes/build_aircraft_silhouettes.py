#!/usr/bin/env python3
"""Project pinned GPL glTF meshes to local, nose-east monochrome SVG sprites.

Development requirements: numpy, Pillow (see requirements-aircraft-icons.txt).
Source downloads are pinned and SHA-256 checked; never used by the application.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import subprocess
from collections import defaultdict
from urllib.parse import quote

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data/aircraft-silhouettes"
OUTPUT = ROOT / "src/assets/aircraft/models"
RESOLUTION = 512


def save(path, content, check):
    if check:
        if not path.exists() or path.read_text() != content:
            raise ValueError(f"Generated file is stale: {path.relative_to(ROOT)}")
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)


def fetch(source, path, destination, checksum=None, offline=False):
    if not destination.exists():
        if offline:
            raise FileNotFoundError(f"Missing cached source: {destination}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        url = f"https://raw.githubusercontent.com/{source['repository']}/{source['revision']}/{quote(path)}"
        subprocess.run(["curl", "--fail", "--location", "--silent", "--show-error", "--retry", "2", url, "-o", str(destination)], check=True)
    payload = destination.read_bytes()
    if checksum and hashlib.sha256(payload).hexdigest() != checksum:
        raise ValueError(f"Source checksum mismatch: {destination}")
    return payload


def triangles(payload, part="all"):
    magic, version, size, json_size, content_format = struct.unpack_from("<5I", payload)
    if magic != 0x46546C67 or version != 1 or size != len(payload) or content_format != 0:
        raise ValueError("Expected the pinned binary glTF 1.0 source")
    doc = json.loads(payload[20:20 + json_size])
    binary = payload[20 + json_size:]

    def accessor(key):
        a = doc["accessors"][key]
        view = doc["bufferViews"][a["bufferView"]]
        dtype = np.dtype({5121: "u1", 5123: "<u2", 5125: "<u4", 5126: "<f4"}[a["componentType"]])
        width = {"SCALAR": 1, "VEC3": 3}[a["type"]]
        stride = a.get("byteStride") or view.get("byteStride") or dtype.itemsize * width
        return np.ndarray((a["count"], width), dtype=dtype, buffer=binary,
                          offset=view.get("byteOffset", 0) + a.get("byteOffset", 0),
                          strides=(stride, dtype.itemsize))

    def walk(key, parent):
        node = doc["nodes"][key]
        if "matrix" in node:
            local = np.array(node["matrix"]).reshape(4, 4, order="F")
        else:
            x, y, z, w = node.get("rotation", [0, 0, 0, 1])
            local = np.eye(4)
            local[:3, :3] = np.array([
                [1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)],
            ]) @ np.diag(node.get("scale", [1, 1, 1]))
            local[:3, 3] = node.get("translation", [0, 0, 0])
        world = parent @ local
        rotor = key.lower().startswith(tuple(f"blade{i}" for i in range(1, 5)))
        meshes = node.get("meshes", []) if part == "all" or (part == "rotor") == rotor else []
        for mesh_key in meshes:
            for primitive in doc["meshes"][mesh_key]["primitives"]:
                if primitive.get("mode", 4) != 4:
                    continue
                positions = accessor(primitive["attributes"]["POSITION"])
                positions = positions @ world[:3, :3].T + world[:3, 3]
                indices = accessor(primitive["indices"]).reshape(-1, 3)
                yield positions[indices]
        for child in node.get("children", []):
            yield from walk(child, world)

    return np.concatenate([t for key in doc["scenes"][doc["scene"]]["nodes"] for t in walk(key, np.eye(4))])


def rasterize(mesh, rotation, reference=None):
    # glTF's vertical axis is Y. X/Z is the orthographic overhead plane.
    points = mesh[:, :, [0, 2]].copy()
    angle = np.deg2rad(rotation)
    points = points @ np.array([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]])
    ref = points if reference is None else reference[:, :, [0, 2]] @ np.array([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]])
    low, high = ref.min(axis=(0, 1)), ref.max(axis=(0, 1))
    scale = (RESOLUTION - 32) / max(high - low)
    points = (points - (low + high) / 2) * scale + RESOLUTION / 2
    image = Image.new("1", (RESOLUTION, RESOLUTION))
    draw = ImageDraw.Draw(image)
    for triangle in points:
        draw.polygon([tuple(v) for v in triangle], fill=1)
    return image


def simplify(points, epsilon=1.25):
    """Ramer-Douglas-Peucker, in raster pixels before scaling to the SVG grid."""
    if len(points) < 3:
        return points
    a, b = np.array(points[0]), np.array(points[-1])
    delta = b - a
    p = np.array(points[1:-1]) - a
    distances = np.abs(delta[0]*p[:, 1] - delta[1]*p[:, 0]) / max(np.linalg.norm(delta), 1e-9)
    index = int(distances.argmax()) + 1
    if distances[index - 1] <= epsilon:
        return [points[0], points[-1]]
    return simplify(points[:index + 1], epsilon)[:-1] + simplify(points[index:], epsilon)


def outline(image):
    mask = np.asarray(image)
    edges = defaultdict(list)
    for y, x in np.argwhere(mask):
        if y == 0 or not mask[y-1, x]: edges[(x, y)].append((x+1, y))
        if x == RESOLUTION-1 or not mask[y, x+1]: edges[(x+1, y)].append((x+1, y+1))
        if y == RESOLUTION-1 or not mask[y+1, x]: edges[(x+1, y+1)].append((x, y+1))
        if x == 0 or not mask[y, x-1]: edges[(x, y+1)].append((x, y))
    paths = []
    while edges:
        start = next(iter(edges))
        loop = [start]
        while True:
            current = loop[-1]
            nxt = edges[current].pop()
            if not edges[current]: del edges[current]
            loop.append(nxt)
            if nxt == start: break
        area = sum(a[0]*b[1] - b[0]*a[1] for a, b in zip(loop, loop[1:])) / 2
        # Ignore holes and detached details smaller than 0.01% of the image.
        if area < 26: continue
        pivot = len(loop)//2
        reduced = simplify(loop[:pivot+1])[:-1] + simplify(loop[pivot:])[:-1]
        coords = [(round(x/8, 2), round(y/8, 2)) for x, y in reduced]
        paths.append("M" + "L".join(f"{x:g} {y:g}" for x, y in coords) + "Z")
    if not paths: raise ValueError("Empty projected silhouette")
    return "".join(paths)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=ROOT / ".cache/aircraft-models")
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--check", action="store_true", help="Compare generated outputs without rewriting them")
    parser.add_argument("--preview", type=Path, help="Write a labelled contact sheet outside the app")
    args = parser.parse_args()
    manifest = json.loads((DATA / "manifest.json").read_text())
    sprites, images, rotors, catalogue, type_metadata = {}, [], {}, {"models": {}, "types": {}}, {}
    for record in manifest["typeRecords"]:
        payload = fetch(manifest["typeSource"], record["path"], DATA / "type-sources" / f"{record['code']}.txt", record["sha256"], args.offline)
        properties = dict(line.split("=", 1) for line in payload.decode("utf-8-sig").splitlines() if "=" in line and not line.startswith("#"))
        if properties.get("ICAO") != record["code"]:
            raise ValueError(f"ICAO reference mismatch: {record['code']}")
        type_metadata[record["code"]] = {key: properties[key] for key in ("ICAO", "MODEL", "CLASS", "ENG_TYPE", "ENG_NUM", "LENGTH", "WINGSPAN") if key in properties}
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for key, model in manifest["models"].items():
        payload = fetch(manifest["modelSource"], model["file"], args.cache / Path(model["file"]).name, model["sha256"], args.offline)
        mesh = triangles(payload)
        image = rasterize(mesh, model["rotation"])
        path = outline(image if key != "heli" else rasterize(triangles(payload, "body"), model["rotation"], mesh))
        if key == "heli":
            rotor = rasterize(triangles(payload, "rotor"), model["rotation"], mesh)
            left, top, right, bottom = rotor.getbbox()
            rotors[key] = {"path": outline(rotor), "cx": (left+right)/16, "cy": (top+bottom)/16}
        sprites[key] = path
        catalogue["models"][key] = {"name": model["name"], "kind": model["kind"]}
        for match, codes in (("type", model["types"]), ("family", model["families"])):
            for code in codes:
                if code in catalogue["types"]: raise ValueError(f"Duplicate type: {code}")
                catalogue["types"][code] = {"id": key, "match": match}
        images.append((key, image))
        rotor_svg = f'<path d="{rotors[key]["path"]}"/>' if key in rotors else ""
        save(OUTPUT / f"{key}.svg", f'<!-- Derived from {model["file"]}; GPL-2.0-only. See data/aircraft-silhouettes/README.md. -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="{path}"/>{rotor_svg}</svg>\n', args.check)
        print(f"{key}: {len(path)} bytes")
    if set(catalogue["types"]) != set(type_metadata):
        raise ValueError("Every mapped code needs a pinned ICAO reference record")
    save(DATA / "paths.json", json.dumps(sprites, separators=(",", ":")) + "\n", args.check)
    save(DATA / "rotors.json", json.dumps(rotors, separators=(",", ":")) + "\n", args.check)
    save(DATA / "catalogue.json", json.dumps(catalogue, indent=2) + "\n", args.check)
    save(DATA / "type-metadata.json", json.dumps(type_metadata, indent=2) + "\n", args.check)
    symbols = [f'<symbol id="aircraft-model-{key}" viewBox="0 0 64 64"><path d="{path}"/></symbol>' for key, path in sprites.items()]
    symbols += [f'<symbol id="aircraft-model-{key}-rotor" viewBox="0 0 64 64"><path d="{rotor["path"]}"/></symbol>' for key, rotor in rotors.items()]
    save(OUTPUT / "sprites.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute;overflow:hidden" data-license="GPL-2.0-only" data-source="/aircraft-silhouettes/README.md"><defs>\n' + '\n'.join(symbols) + '\n</defs></svg>\n', args.check)
    # Include licence notices and the complete regeneration recipe with the site.
    for name in ("README.md", "GPL-2.0.txt", "CC-BY-SA-3.0.txt", "UPSTREAM-MODELS.md", "UPSTREAM-TYPES.md", "manifest.json"):
        save(ROOT / "public/aircraft-silhouettes" / name, (DATA / name).read_text(), args.check)
    for name in ("build_aircraft_silhouettes.py", "requirements-aircraft-icons.txt"):
        save(ROOT / "public/aircraft-silhouettes" / name, (ROOT / "scripts" / name).read_text(), args.check)
    if args.preview:
        sheet = Image.new("RGB", (800, ((len(images)+7)//8)*120), "#fafafa")
        draw = ImageDraw.Draw(sheet)
        for index, (key, image) in enumerate(images):
            x, y = (index % 8)*100, (index//8)*120
            thumb = image.convert("L").resize((88, 88), Image.Resampling.LANCZOS)
            sheet.paste((25, 25, 28), (x+6, y+4), thumb)
            draw.text((x+12, y+97), key, fill="#222")
        sheet.save(args.preview)


if __name__ == "__main__": main()
