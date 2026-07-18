IMPORTING YOUR OWN CHARACTER ART
================================

You can replace the drawn characters (student, professors, Klausuren) with your
own images. The game falls back to the built-in drawn sprites for anything you
do not provide, so you can override just one character or all of them.

HOW
---
1. Put your PNG files in this folder (public/assets/sprites/).
   - Square images work best (e.g. 128x128 or 256x256). Transparent background.
   - The image is scaled to the character size at runtime, so keep the character
     roughly centred and filling most of the square.
2. Create a file called `manifest.json` in this folder that maps sprite keys to
   your filenames. See `manifest.example.json` next to this file for the format.
3. Reload the game. That is it.

SPRITE KEYS
-----------
Each character can be a single image, or four directional images. Directional
images override the single one when the character faces that way.

  player            player_up   player_down   player_left   player_right
  prof1             prof1_up    prof1_down    prof1_left    prof1_right
  prof2             prof2_up    prof2_down    prof2_left    prof2_right
  klausur1          klausur1_up klausur1_down klausur1_left klausur1_right
  klausur2          klausur2_up klausur2_down klausur2_left klausur2_right

  player   = the student
  prof1    = red-accent professor      prof2 = blue-accent professor
  klausur1 = red-header exam sheet      klausur2 = green-header exam sheet

NOTES
-----
- Only the normal state uses your images. The frightened (Freiversuch) and
  eaten states stay as the built-in drawn versions so they read consistently.
- No manifest.json = the game just uses the built-in drawn characters. No error.
