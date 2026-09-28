local root=assert(app.params.root)
local clips={{'idle',129},{'drag',138},{'drag-release',36},{'touch',35},{'water-entry',66},{'water',114},{'water-happy',108},{'work',162}}
for _,clip in ipairs(clips) do
 local name,count=clip[1],clip[2]
 local sprite=Sprite(256,256,ColorMode.RGB)
 sprite.layers[1].name='3D motion review / geometry editable in Blender'
 for f=1,count do
  if f>1 then sprite:newEmptyFrame() end
  sprite.frames[f].duration=(f%3==0 and 34 or 33)/1000
  sprite:newCel(sprite.layers[1],f,Image{fromFile=root..'/source/review-frames/'..name..'/'..string.format('%04d',f)..'.png'},Point(0,0))
 end
 sprite:newTag(1,count).name=name..'_30fps'
 sprite:saveAs(root..'/source/'..name..'-30fps.aseprite')
 if name=='drag' or name=='water-entry' then sprite:saveCopyAs(root..'/preview/'..name..'.gif') end
 sprite:close()
 local reopened=app.open(root..'/source/'..name..'-30fps.aseprite');assert(#reopened.frames==count);reopened:close()
 print('VERIFIED '..name..': '..count..' editable frames')
end
