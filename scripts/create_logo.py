"""Create PNG logo and favicon from SVG."""
import cairosvg
import os
from PIL import Image

PUBLIC_DIR = os.path.join(os.path.dirname(__file__), "..", "packages", "dashboard", "public")
ROOT_DIR = os.path.join(os.path.dirname(__file__), "..")

logo_svg = os.path.join(PUBLIC_DIR, "logo.svg")

logo_png = os.path.join(PUBLIC_DIR, "logo.png")
cairosvg.svg2png(url=logo_svg, write_to=logo_png, output_width=512, output_height=512)
print(f"Created: {logo_png}")

favicon_png = os.path.join(PUBLIC_DIR, "favicon.png")
cairosvg.svg2png(url=logo_svg, write_to=favicon_png, output_width=64, output_height=64)
print(f"Created: {favicon_png}")

favicon_32 = os.path.join(PUBLIC_DIR, "favicon-32.png")
cairosvg.svg2png(url=logo_svg, write_to=favicon_32, output_width=32, output_height=32)
print(f"Created: {favicon_32}")

favicon_16 = os.path.join(PUBLIC_DIR, "favicon-16.png")
cairosvg.svg2png(url=logo_svg, write_to=favicon_16, output_width=16, output_height=16)
print(f"Created: {favicon_16}")

apple_touch = os.path.join(PUBLIC_DIR, "apple-touch-icon.png")
cairosvg.svg2png(url=logo_svg, write_to=apple_touch, output_width=180, output_height=180)
print(f"Created: {apple_touch}")

og_image = os.path.join(PUBLIC_DIR, "og-image.png")
cairosvg.svg2png(url=logo_svg, write_to=og_image, output_width=1200, output_height=630)
print(f"Created: {og_image}")

repo_logo = os.path.join(ROOT_DIR, "logo.png")
cairosvg.svg2png(url=logo_svg, write_to=repo_logo, output_width=512, output_height=512)
print(f"Created: {repo_logo}")

print("\nAll PNG assets generated successfully.")