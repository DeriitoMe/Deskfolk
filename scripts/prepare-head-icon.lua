-- Derive the head icon from the preserved editable pixel master in Aseprite.
local root=assert(app.params.root,'project root required')
local source=assert(app.open(root..'/assets/icons/archive/mutsumi-icon-0.1.0.aseprite'))
local pc=app.pixelColor
local master=Sprite(48,48,ColorMode.RGB)
local sourceNames={'01 Outline and offset shadow','02 Light green hair','03 Face','04 Amber eyes','06 Replaceable triangle clip'}
local flat=Image(48,48,ColorMode.RGB)
local sheets={}
for _,name in ipairs(sourceNames) do
 local layer
 for _,candidate in ipairs(source.layers) do if candidate.name==name then layer=candidate end end
 assert(layer,'Missing master layer '..name)
 local img=Image(48,48,ColorMode.RGB)
 local cel=layer:cel(1)
 if cel then
  for y=0,cel.image.height-1 do for x=0,cel.image.width-1 do
   local px,py=x+cel.position.x,y+cel.position.y
   if px>=0 and px<48 and py>=0 and py<48 then img:drawPixel(px,py,cel.image:getPixel(x,y)) end
  end end
 end
 if name=='06 Replaceable triangle clip' then
  -- The old palette layer also held the navy clip. Retain those pixels only.
  local old=source.layers[5]:cel(1)
  for y=15,22 do for x=31,39 do
   local cx,cy=x-old.position.x,y-old.position.y
   if cx>=0 and cy>=0 and cx<old.image.width and cy<old.image.height then
    local value=old.image:getPixel(cx,cy)
    if pc.rgbaA(value)>0 and pc.rgbaR(value)==52 and pc.rgbaG(value)==53 and pc.rgbaB(value)==74 then img:drawPixel(x,y,value) end
   end
  end end
 end
 -- The jaw ends on row 32; all lower pixels belong to the neck and outfit.
 for y=33,47 do for x=0,47 do img:drawPixel(x,y,0) end end
 for y=0,32 do for x=0,47 do local value=img:getPixel(x,y);if pc.rgbaA(value)>0 then flat:drawPixel(x,y,value) end end end
 sheets[#sheets+1]={name=name,image=img}
end
-- Finish the cropped head with the existing dark pixel contour.
local contour=sheets[1].image
for x=0,47 do
 if pc.rgbaA(flat:getPixel(x,32))>0 then contour:drawPixel(x,33,pc.rgba(58,52,67,255)) end
end
for i,sheet in ipairs(sheets) do
 local l=i==1 and master.layers[1] or master:newLayer()
 l.name=sheet.name
 local enlarged=Image(46,34,ColorMode.RGB)
 for y=0,33 do for x=0,45 do
  enlarged:drawPixel(x,y,sheet.image:getPixel(2+math.floor(x*42/46),4+math.floor(y*31/34)))
 end end
 master:newCel(l,1,enlarged,Point(1,7))
end
master:saveAs(root..'/assets/icons/mutsumi-icon.aseprite')
master:saveCopyAs(root..'/assets/icons/icon-48.png')
master:close();source:close()
local check=assert(app.open(root..'/assets/icons/mutsumi-icon.aseprite'))
assert(check.width==48 and check.height==48 and #check.layers==5)
app.activeSprite=check
app.command.SpriteSize{ui=false,width=576,height=576,method='nearest-neighbor'}
check:saveCopyAs(root..'/.cache/head-icon-preview.png')
check:close()
print('Saved and reopened 48x48 head icon with five editable layers')
