REGISTRY = {}


def building(n, name):
    """Register a modelling function for kit number n (1-40). The function receives a fresh lib.Model."""
    def deco(fn):
        REGISTRY[n] = (name, fn)
        return fn
    return deco
