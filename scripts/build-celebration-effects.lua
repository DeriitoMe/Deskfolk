-- Generate layered effect art with native Aseprite drawing, saves and reopening.
-- aseprite -b --script-param root=<project root> --script scripts/build-celebration-effects.lua
local root = assert(app.params.root, 'project root required')
local dest = root..'/assets/characters/wakaba-mutsumi/celebration-20261002'
local pc = app.pixelColor
local oversample = 3

local function rgba(c, alpha)
  return pc.rgba(c[1],c[2],c[3],math.floor((alpha or 1)*255+.5))
end

local function polygon(points, x, y)
  local inside = false
  local j = #points
  for i=1,#points do
    local a,b=points[i],points[j]
    if ((a[2]>y) ~= (b[2]>y)) and x < (b[1]-a[1])*(y-a[2])/(b[2]-a[2])+a[1] then inside=not inside end
    j=i
  end
  return inside
end

local function bezier(points, p0,p1,p2,p3,n)
  for i=0,n do
    local t=i/n;local u=1-t
    points[#points+1]={u*u*u*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t*t*t*p3[1],u*u*u*p0[2]+3*u*u*t*p1[2]+3*u*t*t*p2[2]+t*t*t*p3[2]}
  end
end

local function drawLayer(sprite,name,color,fn)
  local layer
  if #sprite.layers==1 and sprite.layers[1].name=='Layer 1' then layer=sprite.layers[1] else layer=sprite:newLayer() end
  layer.name=name
  local image=Image(sprite.width,sprite.height,ColorMode.RGB)
  for y=0,sprite.height-1 do for x=0,sprite.width-1 do
    local coverage=0
    for oy=0,oversample-1 do for ox=0,oversample-1 do
      if fn((x+(ox+.5)/oversample)/sprite.width,(y+(oy+.5)/oversample)/sprite.height) then coverage=coverage+1 end
    end end
    if coverage>0 then image:drawPixel(x,y,rgba(color,coverage/(oversample*oversample))) end
  end end
  sprite:newCel(layer,1,image,Point(0,0))
  return layer
end

local records={}
local function save(sprite,name)
  local src=dest..'/source/'..name..'.aseprite'
  sprite:saveAs(src)
  sprite:saveCopyAs(dest..'/runtime/'..name..'.png')
  -- Independent layer PNGs support a fully layered OpenRaster/Krita source.
  local names={}
  for i,layer in ipairs(sprite.layers) do
    names[#names+1]=layer.name
    for _,other in ipairs(sprite.layers) do other.isVisible=other==layer end
    sprite:saveCopyAs(dest..'/source/layers/'..name..'-'..i..'.png')
  end
  for _,layer in ipairs(sprite.layers) do layer.isVisible=true end
  sprite:close()
  local reopened=assert(app.open(src),'native source could not be reopened')
  assert(reopened.width>0 and #reopened.layers==#names)
  records[#records+1]={name=name,width=reopened.width,height=reopened.height,layers=names}
  reopened:close()
  print('NATIVE_ASEPRITE_VERIFIED '..name..' '..#names..' layers')
end

local drop={}
bezier(drop,{.50,.055},{.48,.27},{.19,.42},{.20,.68},24)
bezier(drop,{.20,.68},{.21,.91},{.39,.96},{.50,.96},20)
bezier(drop,{.50,.96},{.66,.96},{.80,.88},{.80,.68},20)
bezier(drop,{.80,.68},{.79,.45},{.55,.27},{.50,.055},24)
local function dropContains(x,y) return polygon(drop,x,y) end
local function interior(x,y)
  return dropContains((x-.5)/.89+.5,(y-.52)/.95+.52)
end
for _,spec in ipairs({{'sweat-large',128,192},{'sweat-small',96,144}}) do
  local sprite=Sprite(spec[2],spec[3],ColorMode.RGB)
  drawLayer(sprite,'01 Soft blue-green contour',{92,158,167},dropContains)
  drawLayer(sprite,'02 Aqua drop body',{174,221,222},interior)
  drawLayer(sprite,'03 Lower soft shade',{138,197,203},function(x,y)return interior(x,y) and y>.66 and x>.50+.06*math.cos(y*7) end)
  drawLayer(sprite,'04 Small curved white glint',{241,252,246},function(x,y)
    local dx=(x-.337)/.057;local dy=(y-.615)/.111
    return dx*dx+dy*dy<1 and interior(x,y)
  end)
  save(sprite,spec[1])
end

local star={{.50,.06},{.60,.37},{.94,.50},{.60,.61},{.50,.94},{.38,.61},{.06,.50},{.38,.38}}
local sprite=Sprite(96,96,ColorMode.RGB)
drawLayer(sprite,'01 Warm gold contour',{201,157,78},function(x,y)return polygon(star,x,y)end)
drawLayer(sprite,'02 Quiet gold fill',{244,218,147},function(x,y)return polygon(star,(x-.5)/.88+.5,(y-.5)/.88+.5)end)
drawLayer(sprite,'03 Soft lower reflection',{233,190,111},function(x,y)return y>.57 and polygon(star,(x-.5)/.88+.5,(y-.5)/.88+.5)end)
drawLayer(sprite,'04 Little ivory glint',{255,249,220},function(x,y)return ((x-.46)/.045)^2+((y-.43)/.10)^2<1 end)
save(sprite,'gentle-star')

sprite=Sprite(64,64,ColorMode.RGB)
local strip={{.15,.25},{.71,.16},{.85,.75},{.29,.84}}
drawLayer(sprite,'01 Confetti paper silhouette',{248,245,227},function(x,y)return polygon(strip,x,y)end)
drawLayer(sprite,'02 Edge fold',{218,215,201},function(x,y)return x>.65 and polygon(strip,x,y)end)
drawLayer(sprite,'03 Tiny paper highlight',{255,254,246},function(x,y)return x<.30 and y<.69 and polygon(strip,x,y)end)
save(sprite,'confetti-strip')

local file=assert(io.open(dest..'/source/aseprite-effects-verification.json','w'))
file:write('{\n  "generator": "scripts/build-celebration-effects.lua",\n  "nativeTool": "Aseprite '..tostring(app.version)..'",\n  "savedAndReopened": true,\n  "assets": [\n')
for i,r in ipairs(records) do
  file:write('    {"name":"'..r.name..'","width":'..r.width..',"height":'..r.height..',"layers":[')
  for j,name in ipairs(r.layers)do file:write((j>1 and ',' or '')..'"'..name..'"')end
  file:write(']}'..(i<#records and ',' or '')..'\n')
end
file:write('  ]\n}\n');file:close()
