"""
Model registry.

`REGISTRY` maps a kit number (1-40) to (name, fn): the LAST registration wins, which is how `buildings_zz_hero.py`
(imported last) replaces the simpler sample versions. Because that is easy to break by renaming a file, every
registration is also recorded in `REGISTRATIONS`, and every replacement in `OVERRIDES`. `build_all.py --strict`
fails when a replacement is not declared in `DECLARED_OVERRIDES` below.
"""
import inspect

REGISTRY = {}
#: Non-base variants, keyed (n, variant): never replace the production model; exported to <out>/variants/<variant>/NN.glb.
VARIANTS = {}
#: Civic hero assets keyed by stable export slug.  Unlike a kit variant they do
#: not consume a catalog number and are written to models/landmarks/.
LANDMARKS = {}
#: Every registration in import order: {"n", "name", "module", "variant", "version", "footprint"}.
REGISTRATIONS = []
#: Replacements: {"n", "replaced_module", "by_module"}.
OVERRIDES = []

#: Kit numbers whose simpler versions are intentionally replaced by `buildings_zz_hero.py`.
DECLARED_OVERRIDES = {
    1: "buildings_zz_hero", 2: "buildings_zz_hero", 3: "buildings_zz_hero", 4: "buildings_zz_hero",
    11: "buildings_zz_hero", 12: "buildings_zz_hero", 13: "buildings_zz_hero",
    24: "buildings_zz_hero", 30: "buildings_zz_hero", 36: "buildings_zz_hero", 37: "buildings_zz_hero",
    38: "buildings_zz_hero",
}


def _caller_module():
    frame = inspect.stack()[2]
    return inspect.getmodule(frame[0]).__name__ if inspect.getmodule(frame[0]) else "?"


def building(n, name, variant="base", version=1, footprint=(1, 1)):
    """Register a modelling function for kit number n (1-40; variants up to 84). The function receives a fresh lib.Model.

    variant is "base" for the production model. Any other variant (e.g. "v2") never replaces it: it is exported
    to variants/<variant>/NN.glb for A/B comparison. footprint is the number of tiles
    (width, depth) the model is designed for, 1x1 for every shipped model today.
    """
    # Base models are the 40-building kit. Variants may also carry the 41-84 expansion numbers: the service
    # tiers ship as x2 (2x2) or x1 (1x1, models/x1/NN.glb) variants beside the kit, never as base models.
    if not 1 <= n <= (40 if variant == "base" else 84):
        raise ValueError(f"kit number out of range for variant {variant}: {n}")

    def deco(fn):
        module = fn.__module__
        if variant != "base":
            REGISTRATIONS.append({"n": n, "name": name, "module": module, "variant": variant, "version": version,
                                  "footprint": list(footprint)})
            VARIANTS[(n, variant)] = (name, fn, version, tuple(footprint))
            return fn
        if n in REGISTRY:
            previous = next(r for r in reversed(REGISTRATIONS) if r["n"] == n)
            OVERRIDES.append({"n": n, "replaced_module": previous["module"], "by_module": module})
        REGISTRATIONS.append({"n": n, "name": name, "module": module, "variant": variant, "version": version,
                              "footprint": list(footprint)})
        REGISTRY[n] = (name, fn)
        return fn
    return deco


def undeclared_overrides():
    """Replacements that DECLARED_OVERRIDES does not account for."""
    return [o for o in OVERRIDES if DECLARED_OVERRIDES.get(o["n"]) != o["by_module"]]


PROPS = {}


def prop(name):
    """Register a prop (tree, vehicle, boat, street furniture) exported to models/props/<name>.glb."""
    def deco(fn):
        PROPS[name] = fn
        return fn
    return deco


def landmark(slug, name, footprint):
    """Register a named civic landmark (footprint is 2x2 or 4x4 tiles)."""
    if footprint not in ((2, 2), (4, 4)):
        raise ValueError("landmark footprint must be 2x2 or 4x4")
    def deco(fn):
        if slug in LANDMARKS:
            raise ValueError(f"duplicate landmark {slug}")
        LANDMARKS[slug] = (name, fn, tuple(footprint))
        return fn
    return deco
