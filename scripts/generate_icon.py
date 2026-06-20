import sys, os

# Add user site-packages
user_site = os.path.join(os.environ.get('APPDATA', ''), 'Python', 'Python314', 'site-packages')
if user_site not in sys.path:
    sys.path.insert(0, 'C:/Users/Ariel/AppData/Local/Packages/PythonSoftwareFoundation.Python.3.14_qbz5n2kfra8p0/LocalCache/local-packages/Python314/site-packages')

from PIL import Image, ImageDraw, ImageFont

# Create a 256x256 icon
size = 256
img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Background: rounded purple square
bg_color = (124, 92, 252, 255)  # #7c5cfc
margin = 20
draw.rounded_rectangle(
    [margin, margin, size - margin, size - margin],
    radius=40,
    fill=bg_color
)

# Draw a book icon (simple)
book_color = (255, 255, 255, 255)
cx, cy = size // 2, size // 2

# Book spine
spine_width = 8
draw.rectangle([cx - spine_width//2, cy - 50, cx + spine_width//2, cy + 50], fill=(255, 255, 255, 180))

# Left page
draw.rounded_rectangle([cx - spine_width//2 - 60, cy - 45, cx - spine_width//2, cy + 45], radius=5, fill=(255, 255, 255, 255))
# Right page
draw.rounded_rectangle([cx + spine_width//2, cy - 45, cx + spine_width//2 + 60, cy + 45], radius=5, fill=(255, 255, 255, 230))

# Pen tip (triangle) at top right of book
pen_points = [(cx + 30, cy - 20), (cx + 50, cy - 55), (cx + 40, cy - 22)]
draw.polygon(pen_points, fill=(255, 220, 100, 255))

# Save
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
res_dir = os.path.join(project_root, 'resources')
os.makedirs(res_dir, exist_ok=True)
out_path = os.path.join(res_dir, 'icon.png')
img.save(out_path)
print(f'Icon saved to {out_path} ({size}x{size})')

# Also create ico
ico_path = os.path.join(res_dir, 'icon.ico')
img.save(ico_path, format='ICO', sizes=[(256, 256), (128, 128), (64, 64), (32, 32), (16, 16)])
print(f'ICO saved to {ico_path}')
