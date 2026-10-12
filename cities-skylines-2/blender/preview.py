"""Isometric preview renders, to compare each model with the kit art."""
import math

import bpy
from mathutils import Vector


def setup_scene(width=480, height=360, top=0.6):
    sc = bpy.context.scene
    try:
        sc.render.engine = "BLENDER_EEVEE"
    except TypeError:
        sc.render.engine = "BLENDER_WORKBENCH"
    sc.render.resolution_x, sc.render.resolution_y = width, height
    sc.render.film_transparent = False
    sc.render.image_settings.media_type = "IMAGE"
    sc.render.image_settings.file_format = "PNG"
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.05, 0.09, 0.16, 1)
    bg.inputs["Strength"].default_value = 1.0
    sc.world = world
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3.0
    so = bpy.data.objects.new("sun", sun)
    so.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    sc.collection.objects.link(so)
    cam = bpy.data.cameras.new("cam")
    cam.type = "ORTHO"
    # frame tall buildings: the view must cover the footprint diagonal and the height
    cam.ortho_scale = max(1.75, top * 1.05 + 1.15)
    co = bpy.data.objects.new("cam", cam)
    # main angle: from the front-right, looking down at 35 degrees (front is -Y)
    d = 4.0
    el, az = math.radians(35), math.radians(-35)
    co.location = Vector((d * math.cos(el) * math.sin(-az) * -1, -d * math.cos(el) * math.cos(az), d * math.sin(el) + top * 0.5))
    sc.collection.objects.link(co)
    look = (Vector((0, 0, top * 0.5)) - co.location).to_track_quat("-Z", "Y")
    co.rotation_euler = look.to_euler()
    sc.camera = co


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
