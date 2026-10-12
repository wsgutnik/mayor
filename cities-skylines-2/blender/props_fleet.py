"""Fleet props: street furniture converted from third_party/mayor-transport-pack (see
fleet_import.py) and parametric vehicles (props_fleet_vehicles.py). Registered like every other prop, so build_all.py exports
them to public/models/props/<name>.glb; budgets live in props_fleet.json.
"""
import fleet_import
from registry import prop

# prop -> (sources, target length/height, triangle budget, kind, scale mode)
FLEET = {
    "shelter_small": (["small_bus_shelter"], 0.36, 120, "furniture", "len"),
    "shelter_glass": (["premium_glass_shelter"], 0.40, 120, "furniture", "len"),
    "stop_sign_bus": (["bus_stop_sign"], 0.28, 120, "furniture", "height"),
    "kiosk_route": (["route_information_kiosk"], 0.22, 120, "furniture", "height"),
    "ticket_machine": (["ticket_machine"], 0.18, 120, "furniture", "height"),
    "bench_road": (["roadside_bench"], 0.20, 120, "furniture", "len"),
    "planter_street": (["street_planter"], 0.18, 120, "furniture", "len"),
    "streetlight_b": (["streetlight"], 0.32, 120, "furniture", "height"),
}


def _make(spec):
    def build(m):
        sources, target, budget, kind, mode = spec
        fleet_import.into_model(m, fleet_import.convert(sources, target, budget, kind, mode))
    return build


for _name, _spec in FLEET.items():
    prop(_name)(_make(_spec))
