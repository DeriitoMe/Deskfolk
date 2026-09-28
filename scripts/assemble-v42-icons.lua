-- Export the approved pixel master with Aseprite's nearest-neighbor scaling.
local root=assert(app.params.root,'project root required')
local output=assert(app.params.output,'temporary output directory required')
for _,size in ipairs({16,20,24,32,40,48,64,128,256}) do
 local sprite=assert(app.open(root..'/assets/icons/mutsumi-icon.aseprite'))
 app.activeSprite=sprite
 if size~=48 then app.command.SpriteSize{ui=false,width=size,height=size,method='nearest-neighbor'} end
 sprite:saveCopyAs(output..'/icon-'..size..'.png')
 sprite:close()
 print('EXPORTED '..size..'x'..size)
end
