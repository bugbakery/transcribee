#!/bin/bash

# this script creates a .ico file for windows and a .icns file for macOS and linux.
# This is a bit hairy, because macOS and linux want padding
# around the icon while windows wants no padding

set -eu

# windows
inkscape icon.svg -w 1024 -h 1024 --export-area='50:50:462:462' -o icon_no_padding.png
npx png2icons icon_no_padding.png icon -icowe -bc -i
rm -rf icon_no_padding.png

# macos
inkscape icon.svg -w 1024 -h 1024 -o icon_padding.png
npx png2icons icon_padding.png icon -icns -bc -i
rm -rf icon_padding.png

# linux
inkscape icon.svg -w 32 -h 32 -o 32x32.png
inkscape icon.svg -w 64 -h 64 -o 64x64.png
inkscape icon.svg -w 128 -h 128 -o 128x128.png
inkscape icon.svg -w 256 -h 256 -o 128x128@2x.png
