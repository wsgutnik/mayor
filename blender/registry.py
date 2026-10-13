REGISTRY = {}


def building(n, name):
    """Register a modelling function for kit number n (1-40). The function receives a fresh lib.Model."""
    def deco(fn):
        REGISTRY[n] = (name, fn)
        return fn
    return deco


PROPS = {}


def prop(name):
    """Register a prop (tree, vehicle, boat, street furniture) exported to models/props/<name>.glb."""
    def deco(fn):
        PROPS[name] = fn
        return fn
    return deco
