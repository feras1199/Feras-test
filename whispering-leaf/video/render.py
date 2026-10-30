"""Procedurally renders the Whispering Leaf 7 s promo (1280x720, 24 fps) to MP4 via ffmpeg.
Stylised illustration, not photoreal: no generative video model was available."""
import subprocess, sys, numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
W,H,FPS,DUR=1280,720,24,7.0
N=int(FPS*DUR); rng=np.random.default_rng(7)
LEAF=(63,90,64); LEAFD=(44,65,46); SAGE=(169,184,160); STONE=(233,227,216); STONE2=(216,207,191)
TIMBER=(154,106,67); SOIL=(59,44,34); WARM=(229,199,155)
def ease(t): t=min(max(t,0),1); return t*t*(3-2*t)
def noise(w,h,scale,seed):
    r=np.random.default_rng(seed); out=np.zeros((h,w))
    for s,a in [(scale,1),(scale/2,.5),(scale/4,.25),(scale/8,.12)]:
        g=r.random((max(2,int(h/s)),max(2,int(w/s))))
        out+=a*np.asarray(Image.fromarray((g*255).astype(np.uint8)).resize((w,h),Image.BICUBIC))/255
    return out/out.max()
def tint(col,lo,hi):
    f=rng.uniform(lo,hi); return tuple(int(min(255,v*f)) for v in col)
def leaf(d,cx,cy,L,ang,col,wid=.38):
    t=np.linspace(0,1,24); a=np.radians(ang); ca,sa=np.cos(a),np.sin(a)
    side=np.sin(np.pi*t)**.9*L*wid
    pts=[(cx+ca*L*x-sa*y, cy+sa*L*x+ca*y) for x,y in list(zip(t,side))+list(zip(t[::-1],-side[::-1]))]
    d.polygon(pts,fill=col)
    d.line([(cx,cy),(cx+ca*L*.95,cy+sa*L*.95)],fill=tuple(min(255,c+35) for c in col),width=max(1,int(L/40)))

# ---- Shot 1: macro of stone + planting, oversized for a slow push-in
S1W,S1H=1600,900
n=noise(S1W,S1H,90,1); grain=rng.random((S1H,S1W))*.12
stone=np.stack([STONE2[i]*(.72+.35*n+grain)-18 for i in range(3)],-1)
img=Image.fromarray(np.clip(stone,0,255).astype(np.uint8)); d=ImageDraw.Draw(img)
for y in (330,620):  # paver joints
    d.line([(0,y),(S1W,y-30)],fill=(150,140,124),width=5)
d.line([(820,0),(780,330)],fill=(150,140,124),width=5)
back=Image.new('RGBA',(S1W,S1H),(0,0,0,0)); bd=ImageDraw.Draw(back)
for _ in range(70):
    c=tint(tuple(rng.choice([LEAF,LEAFD,(86,116,78)])),.6,1.05)
    leaf(bd,rng.uniform(-100,900),rng.uniform(-150,500),rng.uniform(160,330),rng.uniform(-10,80),c)
img.paste(back.filter(ImageFilter.GaussianBlur(5)),(0,0),back.filter(ImageFilter.GaussianBlur(5)))
fore=Image.new('RGBA',(S1W,S1H),(0,0,0,0)); fd=ImageDraw.Draw(fore)
for _ in range(16):
    c=tint(tuple(rng.choice([LEAF,(98,128,82),LEAFD])),.75,1.1)
    leaf(fd,rng.uniform(1000,1700),rng.uniform(500,1000),rng.uniform(260,460),rng.uniform(190,260),c,.3)
shot1=img; shot1_fore=fore.filter(ImageFilter.GaussianBlur(10))

# ---- Shot 2: finished garden, oversized for a pull-back/pan reveal
S2W,S2H=2200,1240
g=Image.new('RGB',(S2W,S2H)); gd=ImageDraw.Draw(g)
for y in range(S2H):  # warm late-afternoon sky
    t=y/S2H; gd.line([(0,y),(S2W,y)],fill=tuple(int(a+(b-a)*t) for a,b in zip((246,226,190),(214,196,170))))
hz=560
gd.rectangle([0,330,S2W,hz],fill=(52,74,52))
for _ in range(320):  # tree canopy / hedge band
    x=rng.uniform(-50,S2W+50); y=rng.uniform(260,hz); r=rng.uniform(40,120)
    c=tint(tuple(LEAF),.55,.95); gd.ellipse([x-r,y-r*.8,x+r,y+r*.8],fill=c)
gd.rectangle([0,hz-40,S2W,hz+60],fill=(60,82,58))
gd.rectangle([0,hz+60,S2W,S2H],fill=(110,140,88))  # lawn
pav=[(S2W*.22,hz+70),(S2W*.80,hz+70),(S2W*1.05,S2H),(S2W*-.05,S2H)]
gd.polygon(pav,fill=(222,206,178))
vx=S2W*.51; vy=hz-260
for i in range(-14,15):  # paver joints in perspective
    xb=S2W*.5+i*150; gd.line([(vx+(xb-vx)*((hz+70-vy)/(S2H-vy)),hz+70),(xb,S2H)],fill=(184,166,138),width=3)
y=hz+70; k=0
while y<S2H:
    k+=1; y+=14*k**.9; gd.line([(0,y),(S2W,y)],fill=(184,166,138),width=3)
gd.polygon([(0,hz+70),(S2W*.22,hz+70),(-S2W*.05,S2H),(0,S2H)],fill=(110,140,88))
for x0,x1 in [(S2W*.30,S2W*.33),(S2W*.67,S2W*.70)]:  # pergola posts
    gd.rectangle([x0,180,x1,hz+150],fill=TIMBER)
gd.rectangle([S2W*.26,160,S2W*.74,205],fill=(130,88,55))
for i in range(13):
    x=S2W*.27+i*S2W*.038; gd.rectangle([x,130,x+16,180],fill=(120,82,50))
for side in (0,1):  # planted beds
    for _ in range(140):
        x=rng.uniform(0,S2W*.24) if side==0 else rng.uniform(S2W*.82,S2W)
        yy=rng.uniform(hz+20,S2H); r=rng.uniform(30,90)*(yy/S2H)
        c=tint(tuple(rng.choice([LEAF,(98,128,82),SAGE])),.6,1.15)
        for _ in range(5): leaf(gd,x,yy,r*1.6,rng.uniform(200,340),tint(c,.85,1.1),.35)
gd.rectangle([S2W*.36,hz+150,S2W*.64,hz+190],fill=(105,72,48))  # timber bench
g=g.filter(ImageFilter.GaussianBlur(1.2))
sun=np.zeros((S2H,S2W)); yy,xx=np.mgrid[0:S2H,0:S2W]
sun=np.exp(-(((xx-S2W*.85)/900)**2+((yy-120)/700)**2))
ga=np.asarray(g).astype(float); ga=ga*(.82+.32*sun[...,None]); ga+=np.array(WARM)*.18*sun[...,None]
shot2=Image.fromarray(np.clip(ga,0,255).astype(np.uint8))

# ---- Shot 3: brand card
def font(paths,size):
    for p in paths:
        try: return ImageFont.truetype(p,size)
        except OSError: pass
    return ImageFont.load_default()
F1=font(['/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'],92)
F2=font(['/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'],38)
card=Image.new('RGB',(W,H),(40,58,42)); cd=ImageDraw.Draw(card)
cn=noise(W,H,120,3); ca=np.asarray(card).astype(float)*(.9+.15*cn[...,None]); card=Image.fromarray(ca.astype(np.uint8))
def brand_layer(alpha_title,alpha_tag,lift):
    L=Image.new('RGBA',(W,H),(0,0,0,0)); d=ImageDraw.Draw(L)
    cx=W//2
    leaf(d,cx-30,232+lift,60,-45,(*SAGE,int(255*alpha_title)),.42)
    t="Whispering Leaf"; bw=d.textlength(t,font=F1); d.text((cx-bw/2,300+lift),t,font=F1,fill=(*STONE,int(255*alpha_title)))
    d.line([(cx-60,425+lift),(cx+60,425+lift)],fill=(*WARM,int(200*alpha_tag)),width=2)
    t2="Outdoor spaces, thoughtfully built."; bw=d.textlength(t2,font=F2); d.text((cx-bw/2,450+lift),t2,font=F2,fill=(*WARM,int(255*alpha_tag)))
    return L

def cam(src,zoom,cx,cy):
    sw,sh=src.size; w=sw/zoom; h=w*H/W
    x0=np.clip(cx*sw-w/2,0,sw-w); y0=np.clip(cy*sh-h/2,0,sh-h)
    return src.resize((W,H),Image.LANCZOS,box=(x0,y0,x0+w,y0+h))
yy1,xx1=np.mgrid[0:H,0:W]
vign=1-.38*(((xx1-W/2)/(W*.7))**2+((yy1-H/2)/(H*.75))**2)
def frame(i):
    t=i/FPS
    # shot 1: 0-3.0 s push in; light band sweeps across
    p=ease(t/3.0)
    a=cam(shot1,1.0+.12*p,.5,.5); fo=cam(shot1_fore,1.0+.2*p,.48+.04*p,.5)
    a=a.convert('RGBA'); a.alpha_composite(fo); a=np.asarray(a.convert('RGB')).astype(float)
    band=-400+ (W+900)*(t/3.2); d=(xx1*0.8+yy1*0.6)-band
    light=np.exp(-(d/260)**2)
    a=a*(.78+.5*light[...,None])+np.array(WARM)*.22*light[...,None]
    # shot 2: 2.4-5.4 s, pull back + drift right
    q=ease((t-2.4)/3.0)
    b=np.asarray(cam(shot2,1.9-.8*q,.40+.10*q,.66-.16*q)).astype(float)
    b=b*(1+.06*np.sin(xx1/W*3+t))[...,None]
    m=ease((t-2.4)/0.9); out=a*(1-m)+b*m
    # shot 3: 5.0 s on, dissolve to brand card
    c=ease((t-5.0)/0.7)
    if c>0:
        cc=np.asarray(card).astype(float); out=out*(1-c)+cc*c
        bl=brand_layer(ease((t-5.3)/.6),ease((t-5.8)/.6),int(12*(1-ease((t-5.3)/.8))))
        base=Image.fromarray(np.clip(out,0,255).astype(np.uint8)).convert('RGBA'); base.alpha_composite(bl)
        out=np.asarray(base.convert('RGB')).astype(float)
    out*=vign[...,None]*(1-.0) ; out=out*(ease(t/0.5))*(1-ease((t-6.6)/0.4)*0)  # fade in from black
    out+=rng.normal(0,2.2,out.shape)  # film grain
    return np.clip(out,0,255).astype(np.uint8)

out=sys.argv[1]
ff=subprocess.Popen(['ffmpeg','-y','-loglevel','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-',
    '-c:v','libx264','-pix_fmt','yuv420p','-crf','20','-preset','slow','-movflags','+faststart',out],stdin=subprocess.PIPE)
for i in range(N):
    fr=frame(i); ff.stdin.write(fr.tobytes())
    if i in (12,48,84,110,150,167): Image.fromarray(fr).save(out.replace('.mp4',f'_f{i:03d}.jpg'),quality=85)
ff.stdin.close(); ff.wait(); print('done',N,'frames')
