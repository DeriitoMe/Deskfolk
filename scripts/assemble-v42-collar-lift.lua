local root=assert(app.params.root)
local clips={{'drag',138},{'drag-release',36},{'drag-entry',12}}
for _,clip in ipairs(clips) do
 local name,count=clip[1],clip[2]
 local sprite=Sprite(512,512,ColorMode.RGB)
 sprite.layers[1].name='Collar suspension / editable 3D controls in Blender'
 for f=1,count do
  if f>1 then sprite:newEmptyFrame() end
  sprite.frames[f].duration=(f%3==0 and 34 or 33)/1000
  sprite:newCel(sprite.layers[1],f,Image{fromFile=root..'/frames/'..name..'/'..string.format('%04d',f)..'.png'},Point(0,0))
 end
 sprite:newTag(1,count).name=name..'_30fps'
 sprite:saveAs(root..'/'..name..'-30fps.aseprite')
 if name=='drag' then sprite:saveCopyAs(root..'/preview/drag.gif') end
 sprite:close()
 local reopened=app.open(root..'/'..name..'-30fps.aseprite')
 assert(#reopened.frames==count)
 reopened:close()
 print('VERIFIED '..name..': '..count..' editable frames')
end
