# 19 — Facility street-frame snapping

Facilities keep their axis-aligned tile mirror for coverage, networks and legacy saves, but new placements use the same local frame as oriented lots.  The pointer selects the nearest ground-road station (within five tiles); its signed normal chooses the side.  Local `+z` faces the road and yaw is `atan2(front.x, front.z)`.

The centre is `centreline - front * (setbackLine + footprint / 2)`, where `setbackLine` is the road profile's `drawHalf + sidewalk + setback`.  Thus the front edge is flush with the setback line. Both sides are valid. The mirror comprises every tile whose centre lies in the rotated square, with a conservative `x/y/w/h` bound retained on the anchor.

Before placement the exact `roadsurface` rectangle oracle rejects asphalt, kerbs, sidewalks and junction rings. The refusal is `No room beside the street here`; water, zones, buildings, existing facilities, money and connected-road checks remain unchanged. With no road in reach placement is legacy axis-aligned, allowing remote parks and preserving old saves. Old anchors have no pose and render as before.

Invariants: deterministic nearest-segment tie-break (segment id), rotated rectangle never overlaps `rectOnRoad`, its front is on the profile setback line, and every mirror tile centre is inside the rectangle. Bulldozing resolves the oriented anchor before clearing only its occupied mirror tiles.
