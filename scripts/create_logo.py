"""Create PNG logo and favicon from the original volcano/pinecone SVG."""
import cairosvg
import os

PUBLIC_DIR = os.path.join(os.path.dirname(__file__), "..", "packages", "dashboard", "public")
ROOT_DIR = os.path.join(os.path.dirname(__file__), "..")

logo_svg = os.path.join(PUBLIC_DIR, "logo.svg")
favicon_svg = os.path.join(PUBLIC_DIR, "favicon.svg")

logo_png = os.path.join(PUBLIC_DIR, "logo.png")
cairosvg.svg2png(url=logo_svg, write_to=logo_png, output_width=512, output_height=512)
print(f"Created: {logo_png}")

for size, name in [(16, "favicon-16.png"), (32, "favicon-32.png"), (64, "favicon.png")]:
    path = os.path.join(PUBLIC_DIR, name)
    cairosvg.svg2png(url=favicon_svg, write_to=path, output_width=size, output_height=size)
    print(f"Created: {path}")

apple_touch = os.path.join(PUBLIC_DIR, "apple-touch-icon.png")
cairosvg.svg2png(url=favicon_svg, write_to=apple_touch, output_width=180, output_height=180)
print(f"Created: {apple_touch}")

og_image = os.path.join(PUBLIC_DIR, "og-image.png")
cairosvg.svg2png(url=logo_svg, write_to=og_image, output_width=1200, output_height=630)
print(f"Created: {og_image}")

repo_logo = os.path.join(ROOT_DIR, "logo.png")
cairosvg.svg2png(url=logo_svg, write_to=repo_logo, output_width=512, output_height=512)
print(f"Created: {repo_logo}")

print("\nAll PNG assets generated from original volcano/pinecone design.")
