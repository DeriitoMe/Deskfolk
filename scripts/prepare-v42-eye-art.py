from pathlib import Path
root=Path(__file__).resolve().parents[1]/'assets/characters/wakaba-mutsumi/v42-motion/source/art'
root.mkdir(parents=True,exist_ok=True)
for name,path in [('squeeze-left','M67 77 L115 128 L67 179'),('squeeze-right','M125 77 L77 128 L125 179')]:
    svg=f'''<svg xmlns="http://www.w3.org/2000/svg" width="192" height="256" viewBox="0 0 192 256"><defs><linearGradient id="gold" gradientUnits="userSpaceOnUse" x1="0" y1="40" x2="0" y2="216"><stop stop-color="#b87925"/><stop offset="1" stop-color="#ca8b30"/></linearGradient></defs><path d="{path}" stroke="url(#gold)" stroke-width="20" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'''
    (root/(name+'.svg')).write_text(svg,encoding='utf8')
print('Krita input SVGs ready')
